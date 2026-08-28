import {
	forwardVector,
	type Player,
	type StaffWeaponConfig,
} from '@transcendence/game-shared';
import { ProjectileWeapon } from './ProjectileWeapon';
import { nearestMonster } from './TargetingSystem';
import type { WeaponAttackContext } from './Weapon';

export class StaffWeapon extends ProjectileWeapon<StaffWeaponConfig> {
	private readonly targets: string[] = [];
	private readonly forward = { x: 0, z: 0 };

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const acquisitionRange =
			this.config.baseAcquisitionRange * this.rangeMultiplier(player);
		context.entities.queryMonsterIdsInRadius(
			context.elapsedS,
			player.x,
			player.z,
			acquisitionRange,
			this.targets,
		);
		const target = nearestMonster(
			context.roomState,
			player,
			acquisitionRange,
			this.targets,
			context.entities.monsterSimulation,
		);
		if (!target) return false;
		const forward = forwardVector(player.rotationY, this.forward);
		const originX = player.x + forward.x * 0.9;
		const originZ = player.z + forward.z * 0.9;
		const dx = target.x - originX;
		const dz = target.z - originZ;
		const length = Math.hypot(dx, dz);
		if (length <= Number.EPSILON) return false;
		const speed = this.stats.speed(this.config.baseProjectileSpeed);
		const quantity = this.stats.quantity(1, player);
		let spawned = false;
		for (let index = 0; index < quantity; index++) {
			const lateral = (index - (quantity - 1) / 2) * 0.35;
			const entity = context.entities.spawn({
				kind: 'fireball',
				weaponKind: 'staff',
				ownerSessionId: this.ownerSessionId,
				behavior: 'targeted-projectile',
				targetId: target.id,
				x: originX + forward.z * lateral,
				y: player.y + 1.2,
				z: originZ - forward.x * lateral,
				directionX: dx / length,
				directionZ: dz / length,
				lifetimeS:
					this.config.maxLifetimeS * this.durationMultiplier(player),
				damage: this.damage(player),
				collisionRadius:
					this.config.collisionRadius *
					this.stats.sizeMultiplier(player),
				hitboxShape: 'sphere',
				velocityX: (dx / length) * speed,
				velocityZ: (dz / length) * speed,
				projectileSpeed: speed,
				maxTurnRateRadiansS:
					(this.config.maxTurnRateDegreesS * Math.PI) / 180,
				penetration: this.stats.penetration(
					this.config.penetration,
					player,
				),
				terrainOffset: 0.65,
			});
			if (!entity) break;
			spawned = true;
		}
		if (!spawned) return false;
		this.limitEntities(context, 'staff', this.config.maxActiveEntities);
		return true;
	}
}
