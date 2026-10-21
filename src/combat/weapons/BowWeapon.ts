import {
	forwardVector,
	type BowWeaponConfig,
	type Player,
} from '@transcendence/game-shared';
import { Weapon } from './Weapon';

export class BowWeapon extends Weapon<BowWeaponConfig> {
	protected attack(player: Player): boolean {
		const { config } = this;
		const forward = forwardVector(player.rotationY);
		const speed = this.speed(config.baseProjectileSpeed);
		const size = this.size(player);
		const angles = config.spreadAnglesDegrees;
		const count = this.quantity(config.projectileCount, player);
		const arrows = Array.from({ length: count }, (_, index) => {
			const degrees =
				count === 1
					? 0
					: angles[0]! +
						((angles[angles.length - 1]! - angles[0]!) * index) /
							(count - 1);
			const angle = (degrees * Math.PI) / 180;
			const directionX =
				forward.x * Math.cos(angle) + forward.z * Math.sin(angle);
			const directionZ =
				forward.z * Math.cos(angle) - forward.x * Math.sin(angle);
			return {
				kind: 'arrow' as const,
				weaponKind: 'bow' as const,
				x: player.x,
				y: player.y + 0.9,
				z: player.z,
				directionX,
				directionZ,
				rotationY: Math.atan2(directionX, directionZ),
				lifetimeS:
					config.maxLifetimeS *
					this.duration(player) *
					this.range(player),
				damage: this.damage(player),
				hitboxShape: 'box' as const,
				hitboxRadius: config.collisionRadius * size,
				hitboxWidth: config.hitboxWidth * size,
				hitboxHeight: config.hitboxHeight * size,
				hitboxDepth: config.hitboxDepth * size,
				velocityX: directionX * speed,
				velocityZ: directionZ * speed,
				penetration: this.penetration(config.penetration, player),
				terrainOffset: 0.15,
			};
		});
		if (this.spawn(...arrows).length === 0) return false;
		this.keepNewest('bow', config.maxActiveEntities);
		return true;
	}
}
