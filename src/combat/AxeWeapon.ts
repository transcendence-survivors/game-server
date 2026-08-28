import { type AxeWeaponConfig, type Player } from '@transcendence/game-shared';
import { ProjectileWeapon } from './ProjectileWeapon';
import type { WeaponAttackContext } from './Weapon';
import { nearestMonster } from './TargetingSystem';

export class AxeWeapon extends ProjectileWeapon<AxeWeaponConfig> {
	private readonly targets: string[] = [];

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const maximumDistance =
			this.config.baseTravelDistance * this.rangeMultiplier(player);
		context.entities.queryMonsterIdsInRadius(
			context.elapsedS,
			player.x,
			player.z,
			maximumDistance,
			this.targets,
		);
		const target = nearestMonster(
			context.roomState,
			player,
			maximumDistance,
			this.targets,
			context.entities.monsterSimulation,
		);
		if (!target) return false;
		const dx = target.x - player.x;
		const dz = target.z - player.z;
		const distance = Math.sqrt(target.distanceSquared);
		if (distance <= Number.EPSILON) return false;
		const directionX = dx / distance;
		const directionZ = dz / distance;
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
			directionX,
			directionZ,
			rotationY: Math.atan2(directionX, directionZ),
			scale: size,
			lifetimeS:
				distance / speed +
				this.config.baseActiveDurationS *
					this.durationMultiplier(player),
			damage: this.damage(player),
			collisionRadius: this.config.baseContactRadius * size,
			hitboxShape: 'cylinder',
			collisionHeight: this.config.baseContactHeight * size,
			velocityX: directionX * speed,
			velocityZ: directionZ * speed,
			contactIntervalS: this.config.damageIntervalS,
			terrainOffset: 0.75,
			travelDistance: distance,
		});
		if (!entity) return false;
		this.limitEntities(context, 'axe', this.config.maxActiveEntities);
		return true;
	}
}
