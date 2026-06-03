/**
 * @file Colyseus room — the orchestration layer between transport and systems.
 *
 * The room has two phases (see {@link RoomPhase}):
 *
 * 1. **Lobby** — players join, set a pseudonym and toggle ready. The host (first
 *    joiner) may kick others. When everyone is ready and the minimum is met the
 *    game auto-starts.
 * 2. **Playing** — the room is locked and the simulation runs: input → movement
 *    → physics, broadcast via Colyseus schema diffing.
 *
 * Responsibilities (and only these):
 * 1. Lifecycle hooks: `onCreate` / `onAuth` / `onJoin` / `onLeave` / `onDispose`.
 * 2. Wire incoming client messages into player state / lobby transitions.
 * 3. Drive the tick pipeline once playing: {@link MovementSystem} → {@link PhysicsSystem}.
 *
 * The room contains **no gameplay logic itself** — math lives in the systems,
 * lobby decisions in `Lobby.ts`, parameters in the configs.
 */

import { Room, ServerError, updateLobby, type Client } from 'colyseus';
import {
	ClientMessage,
	ServerMessage,
	RoomMode,
	RoomPhase,
	KICK_LEAVE_CODE,
	type InputCommand,
	type PingPayload,
	type PongPayload,
	type ReportLatencyPayload,
	type KickPayload,
	type KickedPayload,
	type CreateGameOptions,
	type JoinPublicOptions,
} from '@transcendence/game-shared';

import { loadConfig, type GameConfig } from '../core/ConfigLoader';
import { GameState } from '../schemas/GameState';
import { Player } from '../schemas/Player';
import { MovementSystem } from '../systems/MovementSystem';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { assignSpawns, everyoneReady, nextHostId, sanitizeName } from './Lobby';

/** Colyseus close code returned by `onAuth` rejections, surfaced to the client. */
const AUTH_REJECT_CODE = 4001;

export class GameRoom extends Room<GameState> {
	// Initialised in onCreate. Non-null because Colyseus always calls onCreate
	// before any other lifecycle hook.
	private config!: GameConfig;
	private movement!: MovementSystem;
	private physics!: PhysicsSystem;

	/** Argon2 hash of the host-defined password. Empty for public rooms. */
	private passwordHash = '';

	override async onCreate(options: CreateGameOptions): Promise<void> {
		this.config = loadConfig();
		this.maxClients = this.config.room.maxPlayers;

		const isPrivate = options?.mode === RoomMode.Private;
		const roomName = sanitizeName(
			options?.roomName,
			this.config.room.maxRoomNameLength,
			'Game',
		);

		// Hash the password once at creation — never store or echo plaintext.
		// Note: we deliberately do NOT call `setPrivate(true)`. That would also
		// make the room unmatchable by `client.join(roomName)`, breaking private
		// joins. Instead the room stays matchable (password enforced in onAuth)
		// and is excluded from the public directory by `PublicLobbyRoom`, which
		// lists `mode === 'public'` rooms only.
		if (isPrivate) {
			const password = typeof options?.password === 'string' ? options.password : '';
			if (password.length < this.config.room.minPasswordLength) {
				throw new ServerError(AUTH_REJECT_CODE, 'PASSWORD_TOO_SHORT');
			}
			if (password.length > this.config.room.maxPasswordLength) {
				throw new ServerError(AUTH_REJECT_CODE, 'PASSWORD_TOO_LONG');
			}
			this.passwordHash = await Bun.password.hash(password);
		}

		const state = new GameState();
		state.phase = RoomPhase.Lobby;
		state.roomName = roomName;
		state.mode = isPrivate ? RoomMode.Private : RoomMode.Public;
		this.setState(state);

		this.onMessage<InputCommand>(ClientMessage.Input, (client, msg) => this.handleInput(client, msg));
		this.onMessage<PingPayload>(ClientMessage.Ping, (client, msg) => this.handlePing(client, msg));
		this.onMessage<ReportLatencyPayload>(ClientMessage.ReportLatency, (client, msg) =>
			this.handleReportLatency(client, msg),
		);
		this.onMessage(ClientMessage.ToggleReady, (client) => this.handleToggleReady(client));
		this.onMessage<KickPayload>(ClientMessage.Kick, (client, msg) => this.handleKick(client, msg));

		// The simulation loop does NOT start here — it starts in `startGame()`.
		await this.refreshMetadata();
		updateLobby(this);
	}

	/**
	 * Gate the join: reject if the game already started (no late joins) and, for
	 * private rooms, verify the supplied password against the stored hash. A
	 * rejection here aborts the seat reservation before `onJoin` runs.
	 */
	override async onAuth(client: Client, options: JoinPublicOptions & { password?: string }): Promise<boolean> {
		if (this.state.phase !== RoomPhase.Lobby) {
			throw new ServerError(AUTH_REJECT_CODE, 'GAME_ALREADY_STARTED');
		}
		if (this.state.mode === RoomMode.Private) {
			const password = typeof options?.password === 'string' ? options.password : '';
			const ok = this.passwordHash !== '' && (await Bun.password.verify(password, this.passwordHash));
			if (!ok) {
				throw new ServerError(AUTH_REJECT_CODE, 'WRONG_PASSWORD');
			}
		}
		return true;
	}

	override onJoin(client: Client, options: JoinPublicOptions): void {
		const player = new Player();
		player.id = client.sessionId;
		player.name = sanitizeName(options?.playerName, this.config.room.maxPlayerNameLength, 'Player');
		player.ready = false;

		// First player to join owns the lobby.
		if (this.state.hostId === '') {
			this.state.hostId = client.sessionId;
		}

		this.state.players.set(client.sessionId, player);
		console.log(`[GameRoom] +join ${client.sessionId} as "${player.name}"`);
		void this.refreshMetadata();
		updateLobby(this);
	}

	override onLeave(client: Client): void {
		const wasHost = this.state.hostId === client.sessionId;
		this.state.players.delete(client.sessionId);
		console.log(`[GameRoom] -leave ${client.sessionId}`);

		// In the lobby, hand the host role to the next remaining player and
		// re-evaluate the start condition (a host leaving may make everyone else
		// ready meet the bar). Once playing, host has no special powers.
		if (this.state.phase === RoomPhase.Lobby) {
			if (wasHost) {
				this.state.hostId = nextHostId(this.state);
			}
			void this.refreshMetadata();
			updateLobby(this);
			this.maybeStartGame();
		}
	}

	// --------------------------------------------------------------------- lobby

	private handleToggleReady(client: Client): void {
		if (this.state.phase !== RoomPhase.Lobby) {
			return;
		}
		const player = this.state.players.get(client.sessionId);
		if (player === undefined) {
			return;
		}
		player.ready = !player.ready;
		this.maybeStartGame();
	}

	private handleKick(client: Client, msg: KickPayload): void {
		if (this.state.phase !== RoomPhase.Lobby) {
			return;
		}
		// Only the host may kick, and never itself.
		if (client.sessionId !== this.state.hostId) {
			return;
		}
		const targetId = msg?.targetId;
		if (typeof targetId !== 'string' || targetId === client.sessionId) {
			return;
		}
		const target = this.clients.find((c) => c.sessionId === targetId);
		if (target === undefined) {
			return;
		}
		const payload: KickedPayload = { reason: 'Kicked by host' };
		target.send(ServerMessage.Kicked, payload);
		// onLeave will remove the player and refresh metadata.
		target.leave(KICK_LEAVE_CODE);
	}

	/** Start the game if the lobby's auto-start condition is now satisfied. */
	private maybeStartGame(): void {
		if (this.state.phase !== RoomPhase.Lobby) {
			return;
		}
		if (everyoneReady(this.state, this.config.room.minPlayers)) {
			void this.startGame();
		}
	}

	/**
	 * Transition lobby → playing: lock the room, place spawns, boot the systems
	 * and start the simulation. Idempotent guard prevents a double start.
	 */
	private async startGame(): Promise<void> {
		if (this.state.phase !== RoomPhase.Lobby) {
			return;
		}
		this.state.phase = RoomPhase.Playing;
		await this.lock();

		assignSpawns(this.state, this.config.room);

		this.movement = new MovementSystem(this.config.physics);
		this.physics = new PhysicsSystem(this.config.physics);

		const tickMs = 1000 / this.config.room.tickRate;
		this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), tickMs);
		this.setPatchRate(1000 / this.config.room.patchRate);

		await this.refreshMetadata();
		updateLobby(this);
		console.log(`[GameRoom] start "${this.state.roomName}" with ${this.state.players.size} players`);
	}

	/** Mirror room status into Colyseus metadata so the lobby listing stays current. */
	private async refreshMetadata(): Promise<void> {
		await this.setMetadata({
			roomName: this.state.roomName,
			mode: this.state.mode,
			hasPassword: this.state.mode === RoomMode.Private,
			phase: this.state.phase,
			clients: this.state.players.size,
			maxClients: this.maxClients,
		});
	}

	// -------------------------------------------------------------------- gameplay

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
