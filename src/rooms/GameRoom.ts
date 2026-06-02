/**
 * @file Colyseus room — the orchestration layer between transport and systems.
 *
 * Responsibilities (and only these):
 * 1. Lifecycle hooks: `onCreate` / `onJoin` / `onLeave` / `onDispose`.
 * 2. Wire incoming client messages into the {@link Player} input fields.
 * 3. Drive the tick pipeline: {@link MovementSystem} → {@link PhysicsSystem}.
 *
 * The room contains **no gameplay logic itself**. All math lives in the
 * systems, all parameters live in the configs.
 */

import { Room, type Client } from 'colyseus';
import {
	ClientMessage,
	ServerMessage,
	type InputCommand,
	type PingPayload,
	type PongPayload,
	type ReportLatencyPayload,
} from '@transcendence/game-shared';

import { loadConfig, type GameConfig } from '../core/ConfigLoader';
import { GameState } from '../schemas/GameState';
import { Player } from '../schemas/Player';
import { MovementSystem } from '../systems/MovementSystem';
import { PhysicsSystem } from '../systems/PhysicsSystem';

export class GameRoom extends Room<GameState> {
	// Initialised in onCreate. Non-null because Colyseus always calls onCreate
	// before any other lifecycle hook.
	private config!: GameConfig;
	private movement!: MovementSystem;
	private physics!: PhysicsSystem;

	override onCreate(): void {
		this.config = loadConfig();
		this.maxClients = this.config.room.maxPlayers;

		this.setState(new GameState());

		this.movement = new MovementSystem(this.config.physics);
		this.physics = new PhysicsSystem(this.config.physics);

		this.onMessage<InputCommand>(ClientMessage.Input, (client, msg) => this.handleInput(client, msg));
		this.onMessage<PingPayload>(ClientMessage.Ping, (client, msg) => this.handlePing(client, msg));
		this.onMessage<ReportLatencyPayload>(ClientMessage.ReportLatency, (client, msg) =>
			this.handleReportLatency(client, msg),
		);

		const tickMs = 1000 / this.config.room.tickRate;
		this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), tickMs);

		// Broadcast state diffs at the configured rate (Colyseus defaults to 50ms
		// / 20 Hz). A higher patch rate shortens the simulation→client delay at the
		// cost of bandwidth — fine for a 2-player room.
		this.setPatchRate(1000 / this.config.room.patchRate);
	}

	override onJoin(client: Client): void {
		const player = new Player();
		player.id = client.sessionId;

		// Spread spawns along X so cubes don't overlap on join.
		const slot = this.state.players.size;
		player.x = (slot - (this.config.room.maxPlayers - 1) / 2) * this.config.room.spawnSpread;
		player.y = this.config.room.spawnHeight;
		player.z = 0;

		this.state.players.set(client.sessionId, player);
		console.log(`[GameRoom] +join ${client.sessionId} (slot ${slot})`);
	}

	override onLeave(client: Client): void {
		this.state.players.delete(client.sessionId);
		console.log(`[GameRoom] -leave ${client.sessionId}`);
	}

	private handleInput(client: Client, msg: InputCommand): void {
		const player = this.state.players.get(client.sessionId);
		if (player === undefined) {
			return;
		}
		player.inputMoveX = msg.moveX;
		player.inputMoveZ = msg.moveZ;
		// OR — never overwrite a pending jump with `false`; consumed by PhysicsSystem.
		if (msg.jump) {
			player.inputJump = true;
		}
		// Acknowledge the latest input so the client can reconcile its prediction.
		// WebSocket delivery is ordered, so seq is monotonic — guard against a
		// malformed/absent value rather than letting it regress.
		if (Number.isFinite(msg.seq) && msg.seq > player.lastSeq) {
			player.lastSeq = msg.seq;
		}
	}

	/** Echo the client timestamp so the client can compute RTT without clock sync. */
	private handlePing(client: Client, msg: PingPayload): void {
		const pong: PongPayload = { t: msg.t };
		client.send(ServerMessage.Pong, pong);
	}

	/**
	 * Trust the client's own RTT measurement but clamp it: a buggy or hostile
	 * client must not be able to render absurd values in every other client's
	 * panel. 9999 ms is well past any playable latency.
	 */
	private handleReportLatency(client: Client, msg: ReportLatencyPayload): void {
		const player = this.state.players.get(client.sessionId);
		if (player === undefined) {
			return;
		}
		const raw = Number.isFinite(msg.latencyMs) ? msg.latencyMs : 0;
		player.latencyMs = Math.max(0, Math.min(9999, Math.round(raw)));
	}

	private tick(dt: number): void {
		this.movement.update(this.state, dt);
		this.physics.update(this.state, dt);
		// Wrap before Number.MAX_SAFE_INTEGER so the counter never produces NaN.
		// At the default 30 Hz that's still ~9.5 years of uptime — purely defensive.
		this.state.tick = (this.state.tick + 1) % Number.MAX_SAFE_INTEGER;
	}
}
