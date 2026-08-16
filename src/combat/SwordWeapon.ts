import {
	forwardVector,
	doesHalfCylinderHitVerticalCylinder,
	doesHalfCylinderHitSphere,
	monsterHitboxPrimitives,
	type Player,
	type SwordWeaponConfig,
	type WeaponState,
} from '../../../shared-package';
import { Weapon, type WeaponAttackContext } from './Weapon';

export class SwordWeapon extends Weapon<SwordWeaponConfig> {
	constructor(
		ownerSessionId: string,
		state: WeaponState,
		config: Readonly<SwordWeaponConfig>,
	) {
		super(ownerSessionId, state, config);
	}

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const range = this.config.baseRange * this.rangeMultiplier(player);
		const halfAngle = (this.config.totalAngleDegrees * Math.PI) / 360;
		const rotationY = player.rotationY;
		const origin = {
			x: player.x,
			y: player.y + this.config.hitboxHeight / 2,
			z: player.z,
		};
		const targets: string[] = [];
		context.roomState.monsters.forEach((monster, monsterId) => {
			if (
				!monster.life.isDepleted() &&
				monsterHitboxPrimitives(monster, context.elapsedS).some(
					(part) => {
						const sector = {
							...origin,
							radius: range,
							height: this.config.hitboxHeight,
							rotationY,
							halfAngle,
						};
						return part.shape === 'sphere'
							? doesHalfCylinderHitSphere(sector, part)
							: doesHalfCylinderHitVerticalCylinder(sector, part);
					},
				)
			)
				targets.push(monsterId);
		});
		const forward = forwardVector(rotationY);
		const entity = context.entities.spawn({
			kind: 'sword-slash',
			weaponKind: 'sword',
			ownerSessionId: this.ownerSessionId,
			behavior: 'temporary-attack',
			x: player.x,
			y: origin.y,
			z: player.z,
			directionX: forward.x,
			directionZ: forward.z,
			rotationY,
			scale: range,
			lifetimeS: this.config.effectLifetimeS * this.durationMultiplier(),
			damage: 0,
			collisionRadius: range,
			hitboxShape: 'half-cylinder',
			collisionHeight: this.config.hitboxHeight,
			collisionHalfAngle: halfAngle,
		});
		if (!entity) return false;
		const damage = this.damage(player);
		const knockback =
			this.config.baseKnockback * this.rangeMultiplier(player);
		for (const monsterId of targets.sort()) {
			const monster = context.roomState.monsters.get(monsterId);
			if (!monster) continue;
			const dx = monster.x - player.x;
			const dz = monster.z - player.z;
			const distance = Math.hypot(dx, dz);
			const directionX =
				distance > Number.EPSILON ? dx / distance : forward.x;
			const directionZ =
				distance > Number.EPSILON ? dz / distance : forward.z;
			const result = context.damage.damageMonster(
				{
					playerId: this.ownerSessionId,
					weaponKind: 'sword',
					combatEntityId: entity.id,
					directionX,
					directionZ,
					knockback,
				},
				monsterId,
				damage,
			);
			if (result.fatal) continue;
		}
		return true;
	}
}
