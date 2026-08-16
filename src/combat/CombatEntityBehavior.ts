import {
	type CombatEntity,
	type GameState,
	doVerticalCylindersIntersect,
	doesHalfCylinderHitVerticalCylinder,
	doesHalfCylinderHitSphere,
	doesMovingSphereHitSphere,
	doesMovingSphereHitVerticalCylinder,
	doesSphereHitVerticalCylinder,
	doesSweptBoxHitSphere,
	doesSweptBoxHitVerticalCylinder,
	type CombatHitboxShape,
	type MonsterWorldHitbox,
	type VerticalCylinder,
} from '../../../shared-package';
import type { DamageResolver } from './DamageResolver';
import type { MonsterSpatialIndex } from './MonsterSpatialIndex';

export interface CombatEntityRuntime {
	damage: number;
	collisionRadius: number;
	hitboxShape: CombatHitboxShape;
	collisionHeight: number;
	collisionWidth: number;
	collisionDepth: number;
	collisionHalfAngle: number;
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

export interface CombatEntityUpdateContext {
	state: GameState;
	damage: DamageResolver;
	elapsedS: number;
	terrainHeight: (x: number, z: number) => number;
	monsterHitboxes: ReadonlyMap<string, readonly MonsterWorldHitbox[]>;
	monsterSpatialIndex: MonsterSpatialIndex;
}

export abstract class CombatEntityBehavior {
	protected readonly hitAtS = new Map<string, number>();

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
		const lastHitS = this.hitAtS.get(monsterId);
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
				directionX: entity.directionX,
				directionZ: entity.directionZ,
			},
			monsterId,
			runtime.damage,
		);
		if (result.applied <= 0) return false;
		this.hitAtS.set(monsterId, context.elapsedS);
		return true;
	}

	protected intersectingMonsterIds(
		start: { x: number; y: number; z: number },
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		context: CombatEntityUpdateContext,
	): string[] {
		const matches: string[] = [];
		const radius =
			runtime.hitboxShape === 'box'
				? Math.hypot(runtime.collisionWidth, runtime.collisionDepth) / 2
				: runtime.collisionRadius;
		for (const monsterId of context.monsterSpatialIndex.querySwept(
			start,
			entity,
			radius,
		)) {
			const monster = context.state.monsters.get(monsterId);
			if (!monster || monster.life.isDepleted()) continue;
			const hitboxes = context.monsterHitboxes.get(monsterId);
			if (!hitboxes) continue;
			if (
				this.intersects(start, runtime, entity, hitboxes)
			)
				matches.push(monsterId);
		}
		return matches;
	}

	protected intersects(
		start: { x: number; y: number; z: number },
		runtime: CombatEntityRuntime,
		entity: CombatEntity,
		targets: readonly MonsterWorldHitbox[],
	): boolean {
		const end = { x: entity.x, y: entity.y, z: entity.z };
		return targets.some((target) => {
				switch (runtime.hitboxShape) {
					case 'box':
						return target.shape === 'sphere'
							? doesSweptBoxHitSphere(
									start,
									end,
									runtime.collisionWidth,
									runtime.collisionHeight,
									runtime.collisionDepth,
									entity.directionX,
									entity.directionZ,
									target,
								)
							: doesSweptBoxHitVerticalCylinder(
									start,
									end,
									runtime.collisionWidth,
									runtime.collisionHeight,
									runtime.collisionDepth,
									entity.directionX,
									entity.directionZ,
									target,
								);
					case 'cylinder':
						const cylinder = {
							...end,
							radius: runtime.collisionRadius,
							height: runtime.collisionHeight,
						};
						return target.shape === 'sphere'
							? doesSphereHitVerticalCylinder(target, cylinder)
							: doVerticalCylindersIntersect(cylinder, target);
					case 'half-cylinder':
						const sector = {
							...end,
							radius: runtime.collisionRadius,
							height: runtime.collisionHeight,
							rotationY: entity.rotationY,
							halfAngle: runtime.collisionHalfAngle,
						};
						return target.shape === 'sphere'
							? doesHalfCylinderHitSphere(sector, target)
							: doesHalfCylinderHitVerticalCylinder(
									sector,
									target,
								);
					case 'sphere':
						if (target.shape === 'sphere')
							return doesMovingSphereHitSphere(
								start,
								end,
								runtime.collisionRadius,
								target,
							);
						return start === entity
							? doesSphereHitVerticalCylinder(
									{ ...end, radius: runtime.collisionRadius },
									target,
								)
							: doesMovingSphereHitVerticalCylinder(
									start,
									end,
									runtime.collisionRadius,
									target,
								);
				}
		});
	}
}

export class TargetedProjectileBehavior extends CombatEntityBehavior {
	update(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		dtSeconds: number,
		context: CombatEntityUpdateContext,
	): boolean {
		entity.phase = 'flying';
		const target = context.state.monsters.get(entity.targetId);
		if (target?.life.isDepleted()) entity.targetId = '';
		if (target && !target.life.isDepleted()) {
			const desired = Math.atan2(
				target.z - entity.z,
				target.x - entity.x,
			);
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
			runtime.velocityX = Math.cos(heading) * runtime.projectileSpeed;
			runtime.velocityZ = Math.sin(heading) * runtime.projectileSpeed;
			entity.directionX = Math.cos(heading);
			entity.directionZ = Math.sin(heading);
		}
		const previous = { x: entity.x, y: entity.y, z: entity.z };
		entity.x += runtime.velocityX * dtSeconds;
		entity.z += runtime.velocityZ * dtSeconds;
		entity.y =
			context.terrainHeight(entity.x, entity.z) + runtime.terrainOffset;
		for (const monsterId of this.intersectingMonsterIds(
			previous,
			entity,
			runtime,
			context,
		)) {
			if (!this.hitMonster(entity, runtime, monsterId, context)) continue;
			if (runtime.penetration <= 0) return false;
			runtime.penetration--;
		}
		return true;
	}
}

export class ProjectileBehavior extends CombatEntityBehavior {
	update(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		dtSeconds: number,
		context: CombatEntityUpdateContext,
	): boolean {
		entity.phase = 'flying';
		const previous = { x: entity.x, y: entity.y, z: entity.z };
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
		for (const monsterId of this.intersectingMonsterIds(
			previous,
			entity,
			runtime,
			context,
		)) {
			if (!this.hitMonster(entity, runtime, monsterId, context)) continue;
			if (runtime.penetration <= 0) return false;
			runtime.penetration--;
		}
		return true;
	}
}

export class PersistentZoneBehavior extends CombatEntityBehavior {
	update(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		_dtSeconds: number,
		context: CombatEntityUpdateContext,
	): boolean {
		entity.phase = 'active';
		entity.y =
			context.terrainHeight(entity.x, entity.z) + runtime.terrainOffset;
		for (const monsterId of this.intersectingMonsterIds(
			entity,
			entity,
			runtime,
			context,
		))
			this.hitMonster(entity, runtime, monsterId, context);
		return true;
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
			entity.phase = 'flying';
			const speed = Math.hypot(runtime.velocityX, runtime.velocityZ);
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
			entity.phaseStartedAtS =
				context.elapsedS - Math.max(0, dtSeconds - distance / speed);
		}
		entity.phase = 'active';
		entity.y =
			context.terrainHeight(entity.x, entity.z) + runtime.terrainOffset;
		for (const monsterId of this.intersectingMonsterIds(
			entity,
			entity,
			runtime,
			context,
		))
			this.hitMonster(entity, runtime, monsterId, context);
		return true;
	}
}

export class TemporaryAttackBehavior extends CombatEntityBehavior {
	update(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		_dtSeconds: number,
		context: CombatEntityUpdateContext,
	): boolean {
		entity.phase = 'active';
		for (const monsterId of this.intersectingMonsterIds(
			entity,
			entity,
			runtime,
			context,
		))
			this.hitMonster(entity, runtime, monsterId, context);
		return true;
	}
}
