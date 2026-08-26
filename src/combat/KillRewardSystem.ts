import type { ClientArray } from 'colyseus';
import {
	type GameState,
	type Monster,
	ServerMessage,
} from '@transcendence/game-shared';

export class KillRewardSystem {
	constructor(
		private readonly roomState: GameState,
		private readonly clients: ClientArray,
		private readonly onLevelsGained?: (
			playerId: string,
			levelsGained: number,
		) => void,
	) {}

	healFromDamage(playerId: string, appliedDamage: number): void {
		const player = this.roomState.players.get(playerId);
		if (!player || !Number.isFinite(appliedDamage) || appliedDamage <= 0)
			return;
		player.life.heal(appliedDamage * (player.stats.lifesteal / 100));
	}

	reward(playerId: string, monster: Monster): void {
		const player = this.roomState.players.get(playerId);
		if (!player) return;
		const previousLevel = player.experience.level;
		player.experience.gain(monster.xpReward);
		const levelsGained = player.experience.level - previousLevel;
		if (levelsGained > 0) this.onLevelsGained?.(playerId, levelsGained);
		const client = this.clients.getById(playerId);
		if (client) {
			for (let index = 0; index < levelsGained; index++)
				client.send(ServerMessage.LevelUp);
		}
		player.stats.killAmount++;
	}
}
