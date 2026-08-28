import {
	forwardVector,
	type BowWeaponConfig,
	type Player,
} from '@transcendence/game-shared';
import type { SpawnCombatEntity } from './CombatEntitySystem';
import { ProjectileWeapon } from './ProjectileWeapon';
import type { WeaponAttackContext } from './Weapon';

export class BowWeapon extends ProjectileWeapon<BowWeaponConfig> {
	private readonly inputs: SpawnCombatEntity[] = [];
	private readonly forward = { x: 0, z: 0 };

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const forward = forwardVector(player.rotationY, this.forward);
		const speed = this.stats.speed(this.config.baseProjectileSpeed);
		const lifetimeS =
			this.config.maxLifetimeS *
			this.durationMultiplier(player) *
			this.rangeMultiplier(player);
		const size = this.stats.sizeMultiplier(player);
		const damage = this.damage(player);
		const penetration = this.stats.penetration(
			this.config.penetration,
			player,
		);
		const projectileCount = this.stats.quantity(
			this.config.projectileCount,
			player,
		);
		const configuredAngles = this.config.spreadAnglesDegrees;
		const minAngle = configuredAngles[0];
		const maxAngle = configuredAngles[configuredAngles.length - 1];
		const inputs = this.inputs;
		inputs.length = projectileCount;
		for (let index = 0; index < projectileCount; index++) {
			const degrees =
				projectileCount === configuredAngles.length
					? configuredAngles[index]
					: projectileCount === 1
						? 0
						: minAngle +
							((maxAngle - minAngle) * index) /
								(projectileCount - 1);
			const angle = (degrees * Math.PI) / 180;
			const sin = Math.sin(angle);
			const cos = Math.cos(angle);
			const directionX = forward.x * cos + forward.z * sin;
			const directionZ = forward.z * cos - forward.x * sin;
			inputs[index] = {
				kind: 'arrow',
				weaponKind: 'bow',
				ownerSessionId: this.ownerSessionId,
				behavior: 'projectile',
				x: player.x,
				y: player.y + 0.9,
				z: player.z,
				directionX,
				directionZ,
				rotationY: Math.atan2(directionX, directionZ),
				lifetimeS,
				damage,
				collisionRadius: this.config.collisionRadius * size,
				hitboxShape: 'box',
				collisionWidth: this.config.hitboxWidth * size,
				collisionHeight: this.config.hitboxHeight * size,
				collisionDepth: this.config.hitboxDepth * size,
				velocityX: directionX * speed,
				velocityZ: directionZ * speed,
				penetration,
				terrainOffset: 0.15,
				removeOnTerrainCollision: true,
			};
		}
		if (!context.entities.spawnBatch(inputs)) return false;
		this.limitEntities(context, 'bow', this.config.maxActiveEntities);
		return true;
	}
}
