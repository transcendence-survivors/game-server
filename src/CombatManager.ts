import { Client } from 'colyseus';
import { GameState, MonsterDamageEvent } from '../../shared-package';

export class CombatManager {
	private roomState!: GameState;
	// Événements de dégâts subis par les monstres, accumulés pendant le tick
	// puis diffusés par la room (voir GameRoom). Vidés à chaque diffusion.
	private damageEvents: MonsterDamageEvent[] = [];

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
	 * et par l'aura afin de garder une seule source de vérité pour la mort, la
	 * récompense et l'émission de l'événement de dégâts.
	 */
	damageMonsterBySession(sessionId: string, monsterId: string, amount: number) {
		const monster = this.roomState.monsters.get(monsterId);
		if (!monster || monster.life.isDepleted()) return;
		monster.life.takeDamage(amount);
		const fatal = monster.life.isDepleted();
		// Position capturée maintenant : le coup fatal supprime l'entité juste
		// après, le client doit tout de même pouvoir placer le nombre.
		this.damageEvents.push({
			id: monsterId,
			x: monster.x,
			y: monster.y,
			z: monster.z,
			amount,
			isBoss: monster.isBoss,
			fatal,
		});
		if (!fatal) return;
		this.roomState.players.get(sessionId)?.experience.gain(monster.xpReward);
		this.roomState.monsters.delete(monsterId);
	}

	/** Récupère et vide les événements de dégâts accumulés depuis le dernier appel. */
	drainDamageEvents(): MonsterDamageEvent[] {
		if (this.damageEvents.length === 0) return this.damageEvents;
		const events = this.damageEvents;
		this.damageEvents = [];
		return events;
	}
}
