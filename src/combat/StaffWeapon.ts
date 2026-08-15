import type {
	Player,
	StaffWeaponConfig,
	WeaponState,
} from '../../../shared-package';
import { ProjectileWeapon } from './ProjectileWeapon';
import { TargetingSystem } from './TargetingSystem';
import type { WeaponAttackContext } from './Weapon';

export class StaffWeapon extends ProjectileWeapon<StaffWeaponConfig> {
	constructor(
		ownerSessionId: string,
		state: WeaponState,
		config: Readonly<StaffWeaponConfig>,
	) {
		super(ownerSessionId, state, config);
	}

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const target = new TargetingSystem(context.roomState).nearestMonster(
			player,
			this.config.baseAcquisitionRange * this.rangeMultiplier(player),
		);
		if (!target) return false;
		const dx = target.monster.x - player.x;
		const dz = target.monster.z - player.z;
		const length = Math.hypot(dx, dz);
		if (length <= Number.EPSILON) return false;
		const speed = this.stats.speed(this.config.baseProjectileSpeed);
		const entity = context.entities.spawn({
			kind: 'fireball',
			weaponKind: 'staff',
			ownerSessionId: this.ownerSessionId,
			behavior: 'targeted-projectile',
			targetId: target.id,
			x: player.x,
			y: player.y + 1,
			z: player.z,
			directionX: dx / length,
			directionZ: dz / length,
			lifetimeS: this.config.maxLifetimeS * this.durationMultiplier(),
			damage: this.damage(player),
			collisionRadius:
				this.config.collisionRadius * this.stats.sizeMultiplier(player),
			velocityX: (dx / length) * speed,
			velocityZ: (dz / length) * speed,
			projectileSpeed: speed,
			maxTurnRateRadiansS:
				(this.config.maxTurnRateDegreesS * Math.PI) / 180,
			penetration: this.stats.penetration(this.config.penetration),
			terrainOffset: 0.65,
		});
		if (!entity) return false;
		context.entities.removeOldestOwned(
			this.ownerSessionId,
			'staff',
			this.config.maxActiveEntities,
		);
		return true;
	}
}
