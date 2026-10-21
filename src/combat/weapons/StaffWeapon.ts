import {
	forwardVector,
	type Player,
	type StaffWeaponConfig,
} from '@transcendence/game-shared';
import { Weapon } from './Weapon';

export class StaffWeapon extends Weapon<StaffWeaponConfig> {
	private readonly candidates: string[] = [];

	protected attack(player: Player): boolean {
		const { config } = this;
		const reach = config.baseAcquisitionRange * this.range(player);
		const target = this.combat.hits.nearest(player, reach, this.candidates);
		if (!target) return false;
		const forward = forwardVector(player.rotationY);
		const originX = player.x + forward.x * 0.9;
		const originZ = player.z + forward.z * 0.9;
		const dx = target.monster.x - originX;
		const dz = target.monster.z - originZ;
		const length = Math.hypot(dx, dz);
		if (length <= Number.EPSILON) return false;
		const speed = this.speed(config.baseProjectileSpeed);
		const quantity = this.quantity(1, player);
		let index = 0;
		for (; index < quantity; index++) {
			const lateral = (index - (quantity - 1) / 2) * 0.35;
			const [fireball] = this.spawn({
				kind: 'fireball',
				weaponKind: 'staff',
				targetId: target.id,
				x: originX + forward.z * lateral,
				y: player.y + 1.2,
				z: originZ - forward.x * lateral,
				directionX: dx / length,
				directionZ: dz / length,
				lifetimeS: config.maxLifetimeS * this.duration(player),
				damage: this.damage(player),
				hitboxShape: 'sphere',
				hitboxRadius: config.collisionRadius * this.size(player),
				velocityX: (dx / length) * speed,
				velocityZ: (dz / length) * speed,
				speed,
				turnRateRadiansS: (config.maxTurnRateDegreesS * Math.PI) / 180,
				penetration: this.penetration(config.penetration, player),
				terrainOffset: 0.65,
			});
			if (!fireball) break;
		}
		if (index === 0) return false;
		this.keepNewest('staff', config.maxActiveEntities);
		return true;
	}
}
