import {
	type AuraWeaponConfig,
	type Player,
	type WeaponState,
} from '../../../shared-package';
import { Weapon, type WeaponAttackContext } from './Weapon';

export class AuraWeapon extends Weapon<AuraWeaponConfig> {
	constructor(
		ownerSessionId: string,
		state: WeaponState,
		config: Readonly<AuraWeaponConfig>,
	) {
		super(ownerSessionId, state, config);
	}

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const radius = this.config.baseRadius * this.rangeMultiplier();
		const damage = this.damage(player);
		player.aura.radius = radius;
		player.aura.damage = damage;
		const combatEntityId = `aura:${this.ownerSessionId}:${this.state.activationSequence + 1}`;
		const radiusSquared = radius * radius;
		const hits: string[] = [];
		context.roomState.monsters.forEach((monster, monsterId) => {
			if (monster.life.isDepleted()) return;
			const dx = monster.x - player.x;
			const dz = monster.z - player.z;
			if (dx * dx + dz * dz <= radiusSquared) hits.push(monsterId);
		});
		for (const monsterId of hits.sort())
			context.damage.damageMonster(
				{
					playerId: this.ownerSessionId,
					weaponKind: 'aura',
					combatEntityId,
				},
				monsterId,
				damage,
			);
		return true;
	}
}
