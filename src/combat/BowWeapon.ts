import {
	forwardVector,
	rotateVector,
	type BowWeaponConfig,
	type Player,
	type WeaponState,
} from '../../../shared-package';
import type { SpawnCombatEntity } from './CombatEntitySystem';
import { ProjectileWeapon } from './ProjectileWeapon';
import type { WeaponAttackContext } from './Weapon';

export class BowWeapon extends ProjectileWeapon<BowWeaponConfig> {
	constructor(
		ownerSessionId: string,
		state: WeaponState,
		config: Readonly<BowWeaponConfig>,
	) {
		super(ownerSessionId, state, config);
	}

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const forward = forwardVector(player.rotationY);
		const volleyId = `${this.ownerSessionId}:bow:${this.state.activationSequence + 1}`;
		const speed = this.stats.speed(this.config.baseProjectileSpeed);
		const lifetimeS = this.config.maxLifetimeS * this.durationMultiplier();
		const projectileCount = this.stats.quantity(
			this.config.projectileCount,
		);
		const configuredAngles = this.config.spreadAnglesDegrees;
		const minAngle = configuredAngles[0];
		const maxAngle = configuredAngles[configuredAngles.length - 1];
		const angles =
			projectileCount === configuredAngles.length
				? configuredAngles
				: Array.from({ length: projectileCount }, (_, index) =>
						projectileCount === 1
							? 0
							: minAngle +
								((maxAngle - minAngle) * index) /
									(projectileCount - 1),
					);
		const inputs = angles.map((degrees) => {
			const direction = rotateVector(forward, (degrees * Math.PI) / 180);
			const size = this.stats.sizeMultiplier(player);
			return {
				kind: 'arrow',
				weaponKind: 'bow',
				ownerSessionId: this.ownerSessionId,
				behavior: 'projectile',
				volleyId,
				x: player.x,
				y: player.y + 0.9,
				z: player.z,
				directionX: direction.x,
				directionZ: direction.z,
				rotationY: Math.atan2(direction.x, direction.z),
				lifetimeS,
				damage: this.damage(player),
				collisionRadius: this.config.collisionRadius * size,
				hitboxShape: 'box',
				collisionWidth: this.config.hitboxWidth * size,
				collisionHeight: this.config.hitboxHeight * size,
				collisionDepth: this.config.hitboxDepth * size,
				velocityX: direction.x * speed,
				velocityZ: direction.z * speed,
				penetration: this.stats.penetration(this.config.penetration),
				terrainOffset: 0.15,
				removeOnTerrainCollision: true,
			} satisfies SpawnCombatEntity;
		});
		if (inputs.length !== projectileCount) return false;
		const entities = context.entities.spawnBatch(inputs);
		if (!entities) return false;
		context.entities.removeOldestOwned(
			this.ownerSessionId,
			'bow',
			this.config.maxActiveEntities,
		);
		return true;
	}
}
