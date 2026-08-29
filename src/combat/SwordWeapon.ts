import {
	forwardVector,
	type Player,
	type SwordWeaponConfig,
} from '@transcendence/game-shared';
import { Weapon, type WeaponAttackContext } from './Weapon';

export class SwordWeapon extends Weapon<SwordWeaponConfig> {
	private readonly targets: string[] = [];
	private readonly forward = { x: 0, z: 0 };

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const range =
			this.config.baseRange *
			this.rangeMultiplier(player) *
			this.stats.sizeMultiplier(player);
		const halfAngle = (this.config.totalAngleDegrees * Math.PI) / 360;
		const rotationY = player.rotationY;
		const originY = player.y + this.config.hitboxHeight / 2;
		const forward = forwardVector(rotationY, this.forward);
		const entity = context.entities.spawn({
			kind: 'sword-slash',
			weaponKind: 'sword',
			ownerSessionId: this.ownerSessionId,
			behavior: 'temporary-attack',
			x: player.x,
			y: originY,
			z: player.z,
			directionX: forward.x,
			directionZ: forward.z,
			rotationY,
			scale: range,
			lifetimeS:
				this.config.effectLifetimeS * this.durationMultiplier(player),
			damage: 0,
			collisionRadius: range,
			hitboxShape: 'half-cylinder',
			collisionHeight: this.config.hitboxHeight,
			collisionHalfAngle: halfAngle,
		});
		if (!entity) return false;
		const targets = this.targets;
		context.entities.queryIntersectingMonsterIds(
			context.elapsedS,
			entity,
			entity,
			targets,
		);
		const damage = this.damage(player);
		const knockback =
			this.config.baseKnockback * this.stats.knockbackMultiplier();
		for (const monsterId of targets) {
			context.damage.damageMonster(
				{
					playerId: this.ownerSessionId,
					weaponKind: 'sword',
					combatEntityId: entity.id,
					knockback,
				},
				monsterId,
				damage,
			);
		}
		return true;
	}
}
