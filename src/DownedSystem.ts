import {
	advanceReviveProgress,
	canRevive,
	isWithinReviveRange,
	reviveHealthFor,
	type GameState,
	type Player,
} from '@transcendence/game-shared';

export class DownedSystem {
	private readonly reviveIntents = new Set<string>();

	constructor(private readonly roomState: GameState) {}

	setReviveIntent(sessionId: string, active: boolean): void {
		if (active) this.reviveIntents.add(sessionId);
		else this.reviveIntents.delete(sessionId);
	}

	removePlayer(sessionId: string): void {
		this.reviveIntents.delete(sessionId);
	}

	update(deltaTime: number): void {
		this.roomState.players.forEach((player) => {
			if (player.isDowned || !player.life.isDepleted()) return;
			this.putDown(player);
		});
		this.roomState.players.forEach((player) => {
			if (!player.isDowned) return;
			this.updateRevive(player, deltaTime);
		});
	}

	allPlayersDowned(): boolean {
		if (this.roomState.players.size === 0) return false;
		let allDowned = true;
		this.roomState.players.forEach((player) => {
			if (!player.isDowned) allDowned = false;
		});
		return allDowned;
	}

	private putDown(player: Player): void {
		player.isDowned = true;
		player.reviveProgress = 0;
		player.aura.radius = 0;
	}

	private updateRevive(player: Player, deltaTime: number): void {
		if (!this.hasReviverNearby(player)) {
			if (player.reviveProgress !== 0) player.reviveProgress = 0;
			return;
		}
		const progress = advanceReviveProgress(
			player.reviveProgress,
			deltaTime,
		);
		if (progress < 1) {
			player.reviveProgress = progress;
			return;
		}
		player.life.current = reviveHealthFor(player);
		player.isDowned = false;
		player.reviveProgress = 0;
	}

	private hasReviverNearby(downed: Player): boolean {
		let found = false;
		this.roomState.players.forEach((candidate, sessionId) => {
			if (found || candidate === downed) return;
			if (!this.reviveIntents.has(sessionId)) return;
			if (!canRevive(candidate)) return;
			if (!isWithinReviveRange(candidate, downed)) return;
			found = true;
		});
		return found;
	}
}
