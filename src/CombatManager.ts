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
		const monster = this.roomState.monsters.get(monsterId);
		if (!monster || monster.life.isDepleted()) return;
		monster.life.takeDamage(amount);
		if (!monster.life.isDepleted()) return;
		this.roomState.players
			.get(attacker.sessionId)
			?.experience.gain(monster.xpReward);
		this.roomState.monsters.delete(monsterId);
	}
}
