import { type AxeWeaponConfig, type Player } from '@transcendence/game-shared';
import { Weapon } from './Weapon';

export class AxeWeapon extends Weapon<AxeWeaponConfig> {
	private readonly candidates: string[] = [];

	protected attack(player: Player): boolean {
		const { config } = this;
		const reach = config.baseTravelDistance * this.range(player);
		const target = this.combat.hits.nearest(player, reach, this.candidates);
		if (!target) return false;
		const distance = Math.sqrt(target.distanceSquared);
		if (distance <= Number.EPSILON) return false;
		const directionX = (target.monster.x - player.x) / distance;
		const directionZ = (target.monster.z - player.z) / distance;
		const speed = this.speed(config.baseProjectileSpeed);
		const size = this.size(player);
		const [axe] = this.spawn({
			kind: 'axe',
			weaponKind: 'axe',
			x: player.x,
			y: player.y + 0.75,
			z: player.z,
			directionX,
			directionZ,
			rotationY: Math.atan2(directionX, directionZ),
			scale: size,
			lifetimeS:
				distance / speed +
				config.baseActiveDurationS * this.duration(player),
			damage: this.damage(player),
			hitboxShape: 'cylinder',
			hitboxRadius: config.baseContactRadius * size,
			hitboxHeight: config.baseContactHeight * size,
			velocityX: directionX * speed,
			velocityZ: directionZ * speed,
			contactIntervalS: config.damageIntervalS,
			terrainOffset: 0.75,
			travelDistance: distance,
		});
		if (!axe) return false;
		this.keepNewest('axe', config.maxActiveEntities);
		return true;
	}
}
