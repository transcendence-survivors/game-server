import {
	type AxeWeaponConfig,
	type Player,
	type WeaponState,
} from '../../../shared-package';
import { ProjectileWeapon } from './ProjectileWeapon';
import type { WeaponAttackContext } from './Weapon';
import { TargetingSystem } from './TargetingSystem';

export class AxeWeapon extends ProjectileWeapon<AxeWeaponConfig> {
	constructor(
		ownerSessionId: string,
		state: WeaponState,
		config: Readonly<AxeWeaponConfig>,
	) {
		super(ownerSessionId, state, config);
	}

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const maximumDistance =
			this.config.baseTravelDistance * this.rangeMultiplier(player);
		const target = new TargetingSystem(context.roomState).nearestMonster(
			player,
			maximumDistance,
		);
		if (!target) return false;
		const dx = target.monster.x - player.x;
		const dz = target.monster.z - player.z;
		const distance = Math.sqrt(target.distanceSquared);
		if (distance <= Number.EPSILON) return false;
		const direction = { x: dx / distance, z: dz / distance };
		const speed = this.stats.speed(this.config.baseProjectileSpeed);
		const size = this.stats.sizeMultiplier(player);
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
			rotationY: Math.atan2(direction.x, direction.z),
			scale: size,
			lifetimeS:
				distance / speed +
				this.config.baseActiveDurationS * this.durationMultiplier(),
			damage: this.damage(player),
			collisionRadius: this.config.baseContactRadius * size,
			hitboxShape: 'cylinder',
			collisionHeight: this.config.baseContactHeight * size,
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
