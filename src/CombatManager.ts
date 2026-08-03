import { Client, ClientArray, Room } from 'colyseus';
import { GameState, MonsterDamageEvent } from '../../shared-package';

export class CombatManager {
	private roomState!: GameState;
	private clients: ClientArray;
	private damageEvents: MonsterDamageEvent[] = [];

	constructor(roomState: GameState, clients: ClientArray) {
		this.roomState = roomState;
		this.clients = clients;
	}

	damagePlayer(sessionId: string, amount: number) {
		const player = this.roomState.players.get(sessionId);
		if (!player) return;
		player.life.takeDamage(amount);
	}

	damageMonster(attacker: Client, monsterId: string, amount: number) {
		this.damageMonsterBySession(attacker.sessionId, monsterId, amount);
	}

	damageMonsterBySession(
		sessionId: string,
		monsterId: string,
		amount: number,
	) {
		const monster = this.roomState.monsters.get(monsterId);
		if (!monster || monster.life.isDepleted()) return;
		monster.life.takeDamage(amount);
		const fatal = monster.life.isDepleted();
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
		const player = this.roomState.players.get(sessionId);
		if (!player) return;
		const previousLevel = player.experience.level;
		player.experience.gain(monster.xpReward);
		if (player.experience.level > previousLevel) {
			const levelsGained = player.experience.level - previousLevel;
			const client = this.clients.getById(sessionId);
			if (!client) return;
			for (let i = 0; i < levelsGained; i++) {
				client.send('levelUp');
			}
		}
		this.roomState.monsters.delete(monsterId);
		player.stats.killAmount++;
		player.life.heal(
			(player.stats.attackDamage / 100) * player.stats.lifesteal,
		);
	}

	drainDamageEvents(): MonsterDamageEvent[] {
		if (this.damageEvents.length === 0) return this.damageEvents;
		const events = this.damageEvents;
		this.damageEvents = [];
		return events;
	}
}
