import {
	type AuraWeaponConfig,
	CombatEntity,
	type Player,
} from '@transcendence/game-shared';
import { Weapon, type WeaponAttackContext } from './Weapon';

export class AuraWeapon extends Weapon<AuraWeaponConfig> {
	private readonly targets: string[] = [];
	private readonly hitbox = new CombatEntity();

	protected attack(player: Player, context: WeaponAttackContext): boolean {
		const radius =
			this.config.baseRadius *
			this.rangeMultiplier(player) *
			this.stats.sizeMultiplier(player);
		const damage = this.damage(player);
		player.aura.radius = radius;
		player.aura.attackSpeed = this.stats.attackRate(player);
		player.aura.height = this.config.baseHeight;
		const combatEntityId = `aura:${this.ownerSessionId}:${this.state.activationSequence + 1}`;
		const aura = this.hitbox;
		aura.hitboxShape = 'cylinder';
		aura.x = player.x;
		aura.y = player.y + player.aura.height / 2;
		aura.z = player.z;
		aura.hitboxRadius = radius;
		aura.hitboxHeight = player.aura.height;
		const hits = this.targets;
		context.entities.queryIntersectingMonsterIds(
			context.elapsedS,
			aura,
			aura,
			hits,
		);
		for (const monsterId of hits)
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
