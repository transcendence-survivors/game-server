import {
	type CombatEntity,
	type GameState,
	doesHalfCylinderHitMonsterPart,
	doesMovingSphereHitSphere,
	doesMovingSphereHitVerticalCylinder,
	doesSphereHitVerticalCylinder,
	doesSweptBoxHitSphere,
	doesSweptBoxHitVerticalCylinder,
	doesVerticalCylinderHitMonsterPart,
	type MonsterWorldHitbox,
	type Vec3d,
} from '@transcendence/game-shared';
import type { DamageResolver } from './DamageResolver';
import type {
	MonsterSimulationSource,
	MonsterSpatialQuery,
	MonsterTransform,
} from '../monsters/MonsterSimulationSource';

export interface CombatEntityRuntime {
	behavior: CombatEntityBehavior;
	hitAtS?: Map<string, number>;
	damage: number;
	velocityX: number;
	velocityY: number;
	velocityZ: number;
	penetration: number;
	contactIntervalS: number;
	terrainOffset: number;
	removeOnTerrainCollision: boolean;
	travelRemaining: number;
	projectileSpeed: number;
	maxTurnRateRadiansS: number;
}

type CollisionShape = Parameters<typeof doesHalfCylinderHitMonsterPart>[0];

export interface CombatEntityUpdateContext {
	state: GameState;
	damage: DamageResolver;
	elapsedS: number;
	terrainHeight: (x: number, z: number) => number;
	monsterHitboxes: ReadonlyMap<string, readonly MonsterWorldHitbox[]>;
	monsterSpatialIndex: MonsterSpatialQuery;
	monsterSimulation?: MonsterSimulationSource;
	monsterTransform: MonsterTransform;
	candidates: string[];
	previous: Vec3d;
	collisionShape: CollisionShape;
}

function doesCombatHitboxHitMonsterPart(
	start: Vec3d,
	hitbox: CombatEntity,
	target: MonsterWorldHitbox,
	shape: CollisionShape,
): boolean {
	switch (hitbox.hitboxShape) {
		case 'box':
			return target.shape === 'sphere'
				? doesSweptBoxHitSphere(
						start,
						hitbox,
						hitbox.hitboxWidth,
						hitbox.hitboxHeight,
						hitbox.hitboxDepth,
						hitbox.directionX,
						hitbox.directionZ,
						target,
					)
				: doesSweptBoxHitVerticalCylinder(
						start,
						hitbox,
						hitbox.hitboxWidth,
						hitbox.hitboxHeight,
						hitbox.hitboxDepth,
						hitbox.directionX,
						hitbox.directionZ,
						target,
					);
		case 'cylinder':
			return doesVerticalCylinderHitMonsterPart(shape, target);
		case 'half-cylinder':
			return doesHalfCylinderHitMonsterPart(shape, target);
		case 'sphere':
			if (target.shape === 'sphere')
				return doesMovingSphereHitSphere(
					start,
					hitbox,
					hitbox.hitboxRadius,
					target,
				);
			return start === hitbox
				? doesSphereHitVerticalCylinder(shape, target)
				: doesMovingSphereHitVerticalCylinder(
						start,
						hitbox,
						hitbox.hitboxRadius,
						target,
					);
	}
}

export function collectIntersectingMonsterIds(
	start: Vec3d,
	hitbox: CombatEntity,
	context: Pick<
		CombatEntityUpdateContext,
		'state' | 'monsterHitboxes' | 'monsterSpatialIndex' | 'collisionShape'
	>,
	output: string[],
): string[] {
	const radius =
		hitbox.hitboxShape === 'box'
			? Math.hypot(hitbox.hitboxWidth, hitbox.hitboxDepth) / 2
			: hitbox.hitboxRadius;
	context.monsterSpatialIndex.querySwept(start, hitbox, radius, output);
	const shape = context.collisionShape;
	shape.x = hitbox.x;
	shape.y = hitbox.y;
	shape.z = hitbox.z;
	shape.radius = hitbox.hitboxRadius;
	shape.height = hitbox.hitboxHeight;
	shape.rotationY = hitbox.rotationY;
	shape.halfAngle = hitbox.hitboxHalfAngle;
	let writeIndex = 0;
	for (const id of output) {
		const monster = context.state.monsters.get(id);
		const parts = context.monsterHitboxes.get(id);
		if (!monster || monster.life.isDepleted() || !parts) continue;
		for (const part of parts)
			if (doesCombatHitboxHitMonsterPart(start, hitbox, part, shape)) {
				output[writeIndex++] = id;
				break;
			}
	}
	output.length = writeIndex;
	return output;
}

export abstract class CombatEntityBehavior {
	abstract update(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		dtSeconds: number,
		context: CombatEntityUpdateContext,
	): boolean;

	protected hitMonster(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		monsterId: string,
		context: CombatEntityUpdateContext,
	): boolean {
		const lastHitS = runtime.hitAtS?.get(monsterId);
		if (
			lastHitS !== undefined &&
			context.elapsedS - lastHitS < runtime.contactIntervalS
		)
			return false;
		const result = context.damage.damageMonster(
			{
				playerId: entity.ownerSessionId,
				weaponKind: entity.weaponKind,
				combatEntityId: entity.id,
			},
			monsterId,
			runtime.damage,
		);
		if (result.applied <= 0) return false;
		(runtime.hitAtS ??= new Map()).set(monsterId, context.elapsedS);
		return true;
	}

	protected applyHits(
		start: Vec3d,
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		context: CombatEntityUpdateContext,
		consumePenetration = false,
	): boolean {
		for (const monsterId of collectIntersectingMonsterIds(
			start,
			entity,
			context,
			context.candidates,
		)) {
			if (!this.hitMonster(entity, runtime, monsterId, context)) continue;
			if (!consumePenetration) continue;
			if (runtime.penetration <= 0) return false;
			runtime.penetration--;
		}
		return true;
	}

	protected capturePosition(
		entity: CombatEntity,
		context: CombatEntityUpdateContext,
	): Vec3d {
		context.previous.x = entity.x;
		context.previous.y = entity.y;
		context.previous.z = entity.z;
		return context.previous;
	}

	protected activate(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		context: CombatEntityUpdateContext,
		followTerrain = false,
	): boolean {
		if (followTerrain)
			entity.y =
				context.terrainHeight(entity.x, entity.z) +
				runtime.terrainOffset;
		if (runtime.damage > 0)
			this.applyHits(entity, entity, runtime, context);
		return true;
	}
}

export class TargetedProjectileBehavior extends CombatEntityBehavior {
	update(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		dtSeconds: number,
		context: CombatEntityUpdateContext,
	): boolean {
		const target = context.state.monsters.get(entity.targetId);
		if (!target || target.life.isDepleted()) entity.targetId = '';
		else {
			const exact =
				context.monsterSimulation?.readTransform(
					entity.targetId,
					context.monsterTransform,
				) ?? false;
			const targetX = exact ? context.monsterTransform.x : target.x;
			const targetZ = exact ? context.monsterTransform.z : target.z;
			const desired = Math.atan2(targetZ - entity.z, targetX - entity.x);
			const current = Math.atan2(runtime.velocityZ, runtime.velocityX);
			const delta = Math.atan2(
				Math.sin(desired - current),
				Math.cos(desired - current),
			);
			const turn = Math.max(
				-runtime.maxTurnRateRadiansS * dtSeconds,
				Math.min(runtime.maxTurnRateRadiansS * dtSeconds, delta),
			);
			const heading = current + turn;
			const directionX = Math.cos(heading);
			const directionZ = Math.sin(heading);
			runtime.velocityX = directionX * runtime.projectileSpeed;
			runtime.velocityZ = directionZ * runtime.projectileSpeed;
			entity.directionX = directionX;
			entity.directionZ = directionZ;
		}
		const previous = this.capturePosition(entity, context);
		entity.x += runtime.velocityX * dtSeconds;
		entity.z += runtime.velocityZ * dtSeconds;
		entity.y =
			context.terrainHeight(entity.x, entity.z) + runtime.terrainOffset;
		return this.applyHits(previous, entity, runtime, context, true);
	}
}

export class ProjectileBehavior extends CombatEntityBehavior {
	update(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		dtSeconds: number,
		context: CombatEntityUpdateContext,
	): boolean {
		const previous = this.capturePosition(entity, context);
		entity.x += runtime.velocityX * dtSeconds;
		entity.y += runtime.velocityY * dtSeconds;
		entity.z += runtime.velocityZ * dtSeconds;
		if (
			runtime.removeOnTerrainCollision &&
			entity.y <=
				context.terrainHeight(entity.x, entity.z) +
					runtime.terrainOffset
		)
			return false;
		return this.applyHits(previous, entity, runtime, context, true);
	}
}

export class ZoneBehavior extends CombatEntityBehavior {
	constructor(private readonly followTerrain: boolean) {
		super();
	}

	update(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		_dtSeconds: number,
		context: CombatEntityUpdateContext,
	): boolean {
		return this.activate(entity, runtime, context, this.followTerrain);
	}
}

export class StationaryProjectileBehavior extends CombatEntityBehavior {
	update(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		dtSeconds: number,
		context: CombatEntityUpdateContext,
	): boolean {
		if (runtime.travelRemaining > 0) {
			const speed = runtime.projectileSpeed;
			const distance = Math.min(
				runtime.travelRemaining,
				speed * dtSeconds,
			);
			if (speed > 0) {
				entity.x += (runtime.velocityX / speed) * distance;
				entity.z += (runtime.velocityZ / speed) * distance;
			}
			runtime.travelRemaining -= distance;
			entity.y =
				context.terrainHeight(entity.x, entity.z) +
				runtime.terrainOffset;
			if (runtime.travelRemaining > Number.EPSILON) return true;
			runtime.travelRemaining = 0;
		}
		return this.activate(entity, runtime, context, true);
	}
}
