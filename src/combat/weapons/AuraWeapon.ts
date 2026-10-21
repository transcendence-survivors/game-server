import {
	type AuraWeaponConfig,
	CombatEntity,
	type Player,
} from '@transcendence/game-shared';
import { Weapon } from './Weapon';

export class AuraWeapon extends Weapon<AuraWeaponConfig> {
	private readonly hitbox = new CombatEntity();

	protected attack(player: Player): boolean {
		const { aura } = player;
		aura.radius =
			this.config.baseRadius * this.range(player) * this.size(player);
		aura.attackSpeed = this.attackRate(player);
		aura.height = this.config.baseHeight;
		Object.assign(this.hitbox, {
			hitboxShape: 'cylinder',
			x: player.x,
			y: player.y + aura.height / 2,
			z: player.z,
			hitboxRadius: aura.radius,
			hitboxHeight: aura.height,
		});
		this.strike(
			this.hitbox,
			this.damage(player),
			this.config.baseKnockback,
		);
		return true;
	}
}
