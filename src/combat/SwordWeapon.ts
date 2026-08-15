import {
	forwardVector,
	isCircleInSector,
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
		const origin = { x: player.x, z: player.z };
		const targets: string[] = [];
		context.roomState.monsters.forEach((monster, monsterId) => {
			if (
				!monster.life.isDepleted() &&
				isCircleInSector(
					monster,
					this.config.targetHitboxRadius,
					origin,
					rotationY,
					range,
					halfAngle,
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
			y: player.y,
			z: player.z,
			directionX: forward.x,
			directionZ: forward.z,
			rotationY,
			scale: range,
			lifetimeS: this.config.effectLifetimeS * this.durationMultiplier(),
			damage: 0,
			collisionRadius: 0,
		});
		if (!entity) return false;
		const damage = this.damage(player);
		for (const monsterId of targets.sort())
			context.damage.damageMonster(
				{
					playerId: this.ownerSessionId,
					weaponKind: 'sword',
					combatEntityId: entity.id,
				},
				monsterId,
				damage,
			);
		return true;
	}
}
