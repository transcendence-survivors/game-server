import { GameState, Player, Aura } from '../../shared-package';
import { CombatManager } from './CombatManager';

/** Garde-fou : nombre max de pulsations rattrapées en un seul tick (anti-lag). */
const MAX_CATCHUP_STRIKES = 4;

/**
 * Server-authoritative player aura.
 *
 * Chaque joueur possède un champ de dégâts de contact (schéma `Aura`) qui
 * frappe, à la cadence `attackSpeed`, tous les monstres dont le centre est à
 * portée `radius` (distance horizontale XZ). Les dégâts passent par le
 * CombatManager, donc mort et récompense d'XP suivent le même chemin que
 * l'attaque directe.
 *
 * Purement gameplay : le rendu de l'aura est entièrement côté client.
 */
export class AuraManager {
	constructor(
		private readonly roomState: GameState,
		private readonly combat: CombatManager,
	) {}

	/** Avance les auras ; à appeler depuis la boucle de simulation de la room. */
	update(dtSeconds: number) {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		this.roomState.players.forEach((player, sessionId) => {
			this.updatePlayer(sessionId, player, dtSeconds);
		});
	}

	private updatePlayer(sessionId: string, player: Player, dtSeconds: number) {
		const aura = player.aura;
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
		// Si on a plafonné le rattrapage, on repart proprement pour un cycle.
		if (strikes >= MAX_CATCHUP_STRIKES && player.auraCooldownS <= 0)
			player.auraCooldownS = period;
	}

	private strike(sessionId: string, player: Player, aura: Aura) {
		const r2 = aura.radius * aura.radius;
		// On collecte d'abord les cibles : `damageMonsterBySession` peut
		// supprimer un monstre de la map, muter pendant l'itération est à éviter.
		const hits: string[] = [];
		this.roomState.monsters.forEach((monster, id) => {
			if (monster.life.isDepleted()) return;
			const dx = monster.x - player.x;
			const dz = monster.z - player.z;
			if (dx * dx + dz * dz <= r2) hits.push(id);
		});
		for (const id of hits) {
			this.combat.damageMonsterBySession(sessionId, id, aura.damage);
		}
	}
}
