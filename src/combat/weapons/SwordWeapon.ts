import {
	forwardVector,
	type Player,
	type SwordWeaponConfig,
} from '@transcendence/game-shared';
import { Weapon } from './Weapon';

export class SwordWeapon extends Weapon<SwordWeaponConfig> {
	protected attack(player: Player): boolean {
		const { config } = this;
		const range = config.baseRange * this.range(player) * this.size(player);
		const forward = forwardVector(player.rotationY);
		const [slash] = this.spawn({
			kind: 'sword-slash',
			weaponKind: 'sword',
			x: player.x,
			y: player.y + config.hitboxHeight / 2,
			z: player.z,
			directionX: forward.x,
			directionZ: forward.z,
			rotationY: player.rotationY,
			scale: range,
			lifetimeS: config.effectLifetimeS * this.duration(player),
			damage: 0,
			hitboxShape: 'half-cylinder',
			hitboxRadius: range,
			hitboxHeight: config.hitboxHeight,
			hitboxHalfAngle: (config.totalAngleDegrees * Math.PI) / 360,
		});
		if (!slash) return false;
		const knockback =
			config.baseKnockback * (1 + this.state.knockbackBonus);
		this.strike(slash, this.damage(player), knockback);
		return true;
	}
}
