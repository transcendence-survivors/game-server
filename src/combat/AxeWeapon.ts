import {
	forwardVector,
	type AxeWeaponConfig,
	type Player,
	type WeaponState,
} from '../../../shared-package';
import { ProjectileWeapon } from './ProjectileWeapon';
import type { WeaponAttackContext } from './Weapon';

export class AxeWeapon extends ProjectileWeapon<AxeWeaponConfig> {
	constructor(
		ownerSessionId: string,
		state: WeaponState,
		config: Readonly<AxeWeaponConfig>,
	) {
		super(ownerSessionId, state, config);
	}

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const direction = forwardVector(player.rotationY);
		const speed = this.config.baseProjectileSpeed;
		const distance = this.config.baseTravelDistance * this.rangeMultiplier();
		const entity = context.entities.spawn({
			kind: 'axe',
			weaponKind: 'axe',
			ownerSessionId: this.ownerSessionId,
			behavior: 'stationary-projectile',
			x: player.x,
			y: player.y + 0.75,
			z: player.z,
			directionX: direction.x,
			directionZ: direction.z,
			rotationY: player.rotationY,
			lifetimeS:
				distance / speed +
				this.config.baseActiveDurationS * this.durationMultiplier(),
			damage: this.damage(player),
			collisionRadius:
				this.config.baseContactRadius * this.rangeMultiplier(),
			velocityX: direction.x * speed,
			velocityZ: direction.z * speed,
			contactIntervalS: this.config.damageIntervalS,
			terrainOffset: 0.75,
			travelDistance: distance,
		});
		if (!entity) return false;
		context.entities.removeOldestOwned(
			this.ownerSessionId,
			'axe',
			this.config.maxActiveEntities,
		);
		return true;
	}
}
