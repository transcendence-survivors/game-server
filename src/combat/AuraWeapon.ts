import {
	type AuraWeaponConfig,
	type Player,
	type WeaponState,
	doVerticalCylindersIntersect,
	doesSphereHitVerticalCylinder,
	monsterHitboxPrimitives,
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
		const radius = this.config.baseRadius * this.rangeMultiplier(player);
		const damage = this.damage(player);
		player.aura.radius = radius;
		player.aura.damage = damage;
		player.aura.height = this.config.baseHeight;
		const combatEntityId = `aura:${this.ownerSessionId}:${this.state.activationSequence + 1}`;
		const hits: string[] = [];
		context.roomState.monsters.forEach((monster, monsterId) => {
			if (monster.life.isDepleted()) return;
			const aura = {
				x: player.x,
				y: player.y + player.aura.height / 2,
				z: player.z,
				radius,
				height: player.aura.height,
			};
			if (
				monsterHitboxPrimitives(monster, context.elapsedS).some(
					(part) =>
						part.shape === 'sphere'
							? doesSphereHitVerticalCylinder(part, aura)
							: doVerticalCylindersIntersect(aura, part),
				)
			)
				hits.push(monsterId);
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
