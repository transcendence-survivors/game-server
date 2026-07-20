import { Client } from 'colyseus';
import { GameState } from '../../shared-package';

export class CombatManager {
	private roomState!: GameState;

	constructor(roomState: GameState) {
		this.roomState = roomState;
	}

	damagePlayer(sessionId: string, amount: number) {
		const player = this.roomState.players.get(sessionId);
		if (!player) return;
		player.life.takeDamage(amount);
	}

	damageMonster(attacker: Client, monsterId: string, amount: number) {
		this.damageMonsterBySession(attacker.sessionId, monsterId, amount);
	}

	/**
	 * Applique des dégâts à un monstre au nom d'un joueur (sessionId). Le
	 * joueur récupère l'XP si le coup est fatal. Partagé par l'attaque directe
	 * et par l'aura afin de garder une seule source de vérité pour la mort et
	 * la récompense des monstres.
	 */
	damageMonsterBySession(sessionId: string, monsterId: string, amount: number) {
		const monster = this.roomState.monsters.get(monsterId);
		if (!monster || monster.life.isDepleted()) return;
		monster.life.takeDamage(amount);
		if (!monster.life.isDepleted()) return;
		this.roomState.players.get(sessionId)?.experience.gain(monster.xpReward);
		this.roomState.monsters.delete(monsterId);
	}
}
