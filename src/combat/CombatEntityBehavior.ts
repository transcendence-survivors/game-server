import {
	type CombatEntity,
	type GameState,
	type Monster,
	doesMovingCircleHitCircle,
} from '../../../shared-package';
import type { DamageResolver } from './DamageResolver';

export interface CombatEntityRuntime {
	damage: number;
	collisionRadius: number;
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
			},
			monsterId,
			runtime.damage,
		);
		if (result.applied <= 0) return false;
		this.hitAtS.set(monsterId, context.elapsedS);
		return true;
	}

	protected overlappingMonsters(
		entity: CombatEntity,
		runtime: CombatEntityRuntime,
		state: GameState,
	): Array<readonly [string, Monster]> {
		const matches: Array<readonly [string, Monster]> = [];
		state.monsters.forEach((monster, monsterId) => {
			if (monster.life.isDepleted()) return;
			const dx = monster.x - entity.x;
			const dz = monster.z - entity.z;
			if (dx * dx + dz * dz <= runtime.collisionRadius ** 2)
				matches.push([monsterId, monster]);
		});
		return matches.sort(([left], [right]) => left.localeCompare(right));
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
			const desired = Math.atan2(target.z - entity.z, target.x - entity.x);
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
		const previous = { x: entity.x, z: entity.z };
		entity.x += runtime.velocityX * dtSeconds;
		entity.z += runtime.velocityZ * dtSeconds;
		entity.y =
			context.terrainHeight(entity.x, entity.z) + runtime.terrainOffset;
		const hits: string[] = [];
		context.state.monsters.forEach((monster, monsterId) => {
			if (
				!monster.life.isDepleted() &&
				doesMovingCircleHitCircle(
					previous,
					{ x: entity.x, z: entity.z },
					runtime.collisionRadius,
					monster,
					0,
				)
			)
				hits.push(monsterId);
		});
		for (const monsterId of hits.sort()) {
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
		const previous = { x: entity.x, z: entity.z };
		entity.x += runtime.velocityX * dtSeconds;
		entity.y += runtime.velocityY * dtSeconds;
		entity.z += runtime.velocityZ * dtSeconds;
		if (
			runtime.removeOnTerrainCollision &&
			entity.y <=
				context.terrainHeight(entity.x, entity.z) + runtime.terrainOffset
		)
			return false;
		const hits: string[] = [];
		context.state.monsters.forEach((monster, monsterId) => {
			if (
				!monster.life.isDepleted() &&
				doesMovingCircleHitCircle(
					previous,
					{ x: entity.x, z: entity.z },
					runtime.collisionRadius,
					monster,
					0,
				)
			)
				hits.push(monsterId);
		});
		hits.sort();
		for (const monsterId of hits) {
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
		for (const [monsterId] of this.overlappingMonsters(
			entity,
			runtime,
			context.state,
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
			const distance = Math.min(runtime.travelRemaining, speed * dtSeconds);
			if (speed > 0) {
				entity.x += (runtime.velocityX / speed) * distance;
				entity.z += (runtime.velocityZ / speed) * distance;
			}
			runtime.travelRemaining -= distance;
			entity.y =
				context.terrainHeight(entity.x, entity.z) + runtime.terrainOffset;
			if (runtime.travelRemaining > Number.EPSILON) return true;
			runtime.travelRemaining = 0;
			entity.phaseStartedAtS =
				context.elapsedS - Math.max(0, dtSeconds - distance / speed);
		}
		entity.phase = 'active';
		entity.y =
			context.terrainHeight(entity.x, entity.z) + runtime.terrainOffset;
		for (const [monsterId] of this.overlappingMonsters(
			entity,
			runtime,
			context.state,
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
		for (const [monsterId] of this.overlappingMonsters(
			entity,
			runtime,
			context.state,
		))
			this.hitMonster(entity, runtime, monsterId, context);
		return true;
	}
}
