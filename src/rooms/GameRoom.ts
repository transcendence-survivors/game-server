import { Room, Client } from 'colyseus';
import { GameState, PlayerState } from '../state/GameState';

const TICK_RATE_HZ = 30;

export class GameRoom extends Room<GameState> {
	override maxClients = 16;

	override onCreate(_options: unknown): void {
		this.setState(new GameState());
		this.state.startedAt = Date.now();

		this.onMessage('latency_probe', (client) => {
			client.send('latency_probe_ack', { serverTime: Date.now() });
		});

		this.onMessage('report_run', (client, payload: { score?: number; survivedMs?: number }) => {
			const score = payload?.score ?? 0;
			const ms = payload?.survivedMs ?? 0;
			console.log(`[GameRoom] run reported: ${client.sessionId} score=${score} time=${ms}ms`);
		});

		this.setSimulationInterval((dt) => this.tick(dt), 1000 / TICK_RATE_HZ);

		console.log(`[GameRoom] created (id=${this.roomId})`);
	}

	override onJoin(client: Client, options: { name?: string }): void {
		const player = new PlayerState();
		player.sessionId = client.sessionId;
		player.name = options?.name ?? 'Player';
		player.joinedAt = Date.now();
		this.state.players.set(client.sessionId, player);
		console.log(`[GameRoom] joined: ${client.sessionId} (${player.name})`);
	}

	override onLeave(client: Client): void {
		this.state.players.delete(client.sessionId);
		console.log(`[GameRoom] left: ${client.sessionId}`);
	}

	override onDispose(): void {
		console.log(`[GameRoom] disposed (id=${this.roomId})`);
	}

	private tick(_deltaTimeMs: number): void {
		this.state.tick++;
	}
}
