import { GameState, Player, Aura } from '../../shared-package';
import { DamageResolver } from './combat/DamageResolver';

const MAX_CATCHUP_STRIKES = 4;

export class AuraManager {
	constructor(
		private readonly roomState: GameState,
		private readonly damage: DamageResolver,
	) {}

	update(dtSeconds: number) {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		this.roomState.players.forEach((player, sessionId) => {
			this.updatePlayer(sessionId, player, dtSeconds);
		});
	}

	private updatePlayer(sessionId: string, player: Player, dtSeconds: number) {
		const aura = player.aura;
		aura.damage = player.stats.attackDamage; // TODO
		aura.attackSpeed = player.stats.attackSpeed; // TODO
		aura.radius = player.stats.range; // TODO
		if (player.life.isDepleted()) return;
		if (aura.attackSpeed <= 0 || aura.damage <= 0 || aura.radius <= 0)
			return;

		const period = 1 / aura.attackSpeed;
		player.auraCooldownS -= dtSeconds;
		let strikes = 0;
		while (player.auraCooldownS <= 0 && strikes < MAX_CATCHUP_STRIKES) {
			player.auraCooldownS += period;
			this.strike(sessionId, player, aura);
			strikes++;
		}
		if (strikes >= MAX_CATCHUP_STRIKES && player.auraCooldownS <= 0)
			player.auraCooldownS = period;
	}

	private strike(sessionId: string, player: Player, aura: Aura) {
		const weapon = player.weapons.get('aura');
		if (!weapon) return;
		weapon.activationSequence++;
		const combatEntityId = `aura:${sessionId}:${weapon.activationSequence}`;
		const r2 = aura.radius * aura.radius;
		const hits: string[] = [];
		this.roomState.monsters.forEach((monster, id) => {
			if (monster.life.isDepleted()) return;
			const dx = monster.x - player.x;
			const dz = monster.z - player.z;
			if (dx * dx + dz * dz <= r2) hits.push(id);
		});
		for (const id of hits) {
			this.damage.damageMonster(
				{
					playerId: sessionId,
					weaponKind: 'aura',
					combatEntityId,
				},
				id,
				aura.damage,
			);
		}
	}
}
