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
	STREAM_RADIUS,
	MIN_CHUNK,
	MAX_CHUNK,
	worldToChunk,
	chunkKey,
	type InputCommand,
	type PingPayload,
	type PongPayload,
	type ReportLatencyPayload,
	type KickPayload,
	type KickedPayload,
	type ChunkPayload,
	type ChunkDropPayload,
	type CreateGameOptions,
	type JoinPublicOptions,
} from '@transcendence/game-shared';

import { loadConfig, type GameConfig } from '../core/ConfigLoader';
import { TerrainService } from '../core/TerrainService';
import { GameState } from '../schemas/GameState';
import { Player } from '../schemas/Player';
import { MovementSystem } from '../systems/MovementSystem';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { assignSpawns, everyoneReady, nextHostId, sanitizeName } from './Lobby';

/** Colyseus close code returned by `onAuth` rejections, surfaced to the client. */
const AUTH_REJECT_CODE = 4001;

/** Run the chunk streamer every N simulation ticks (≈4 Hz at a 60 Hz tick rate). */
const STREAM_INTERVAL_TICKS = 15;

export class GameRoom extends Room<GameState> {
	// Initialised in onCreate. Non-null because Colyseus always calls onCreate
	// before any other lifecycle hook.
	private config!: GameConfig;
	private movement!: MovementSystem;
	private physics!: PhysicsSystem;
	private terrain!: TerrainService;

	/** Argon2 hash of the host-defined password. Empty for public rooms. */
	private passwordHash = '';

	/** True for a single-seat room that auto-starts the moment its creator joins. */
	private isSolo = false;

	/** Procedural world seed (mirrored into `state.seed`), chosen at creation. */
	private seed = 0;

	/** Per-client set of chunk keys currently streamed to that client. */
	private readonly loadedChunks = new Map<string, Set<string>>();

	/** Clients that have entered the world scene and may receive chunk streams. */
	private readonly worldReady = new Set<string>();

	override async onCreate(options: CreateGameOptions): Promise<void> {
		this.config = loadConfig();
		this.terrain = await TerrainService.instance();
		// One world seed per room, fixed at creation. 32-bit to match the wasm ABI.
		this.seed = (Math.random() * 0x1_0000_0000) >>> 0;

		const isPrivate = options?.mode === RoomMode.Private;
		this.isSolo = options?.mode === RoomMode.Solo;
		// Solo rooms hold exactly one player; everyone else uses the configured cap.
		this.maxClients = this.isSolo ? 1 : this.config.room.maxPlayers;

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
		state.mode = this.isSolo ? RoomMode.Solo : isPrivate ? RoomMode.Private : RoomMode.Public;
		state.seed = this.seed;
		this.setState(state);

		this.onMessage<InputCommand>(ClientMessage.Input, (client, msg) => this.handleInput(client, msg));
		this.onMessage<PingPayload>(ClientMessage.Ping, (client, msg) => this.handlePing(client, msg));
		this.onMessage<ReportLatencyPayload>(ClientMessage.ReportLatency, (client, msg) =>
			this.handleReportLatency(client, msg),
		);
		this.onMessage(ClientMessage.ToggleReady, (client) => this.handleToggleReady(client));
		this.onMessage<KickPayload>(ClientMessage.Kick, (client, msg) => this.handleKick(client, msg));
		this.onMessage(ClientMessage.EnterWorld, (client) => this.handleEnterWorld(client));

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

		// A solo room has no lobby step: ready the lone player up so the shared
		// start condition fires immediately and we drop straight into the game.
		if (this.isSolo) {
			player.ready = true;
		}

		this.state.players.set(client.sessionId, player);
		console.log(`[GameRoom] +join ${client.sessionId} as "${player.name}"`);
		void this.refreshMetadata();
		updateLobby(this);
		this.maybeStartGame();
	}

	override onLeave(client: Client): void {
		const wasHost = this.state.hostId === client.sessionId;
		this.state.players.delete(client.sessionId);
		this.loadedChunks.delete(client.sessionId);
		this.worldReady.delete(client.sessionId);
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
		// A solo room starts with its single player; others need the configured min.
		const minPlayers = this.isSolo ? 1 : this.config.room.minPlayers;
		if (everyoneReady(this.state, minPlayers)) {
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
		// Drop each spawn onto the terrain surface beneath it (spawns are spread
		// near the origin by `assignSpawns`, which only knows the flat XZ layout).
		for (const player of this.state.players.values()) {
			player.y = this.terrain.heightAt(this.seed, player.x, player.z) + this.config.physics.groundY;
		}

		this.movement = new MovementSystem(this.config.physics);
		this.physics = new PhysicsSystem(this.config.physics, (x, z) => this.terrain.heightAt(this.seed, x, z));

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

		// Re-evaluate each player's streaming window periodically (not every tick —
		// chunk membership only changes as players cross chunk boundaries).
		if (this.state.tick % STREAM_INTERVAL_TICKS === 0) {
			for (const client of this.clients) {
				if (this.worldReady.has(client.sessionId)) {
					this.streamChunks(client);
				}
			}
		}
	}

	// ------------------------------------------------------------- terrain streaming

	/**
	 * Mark a client ready to receive terrain and send its initial window. Called
	 * when the client signals it has entered the world scene, so the first burst is
	 * never sent before the client's chunk handlers exist.
	 */
	private handleEnterWorld(client: Client): void {
		if (this.state.phase !== RoomPhase.Playing) {
			return;
		}
		this.worldReady.add(client.sessionId);
		this.streamChunks(client);
	}

	/**
	 * Reconcile a client's loaded chunks with the streaming window around its
	 * player: send chunks that just entered range, drop chunks that left it.
	 */
	private streamChunks(client: Client): void {
		const player = this.state.players.get(client.sessionId);
		if (player === undefined) {
			return;
		}

		const pcx = worldToChunk(player.x);
		const pcz = worldToChunk(player.z);

		let loaded = this.loadedChunks.get(client.sessionId);
		if (loaded === undefined) {
			loaded = new Set();
			this.loadedChunks.set(client.sessionId, loaded);
		}

		// Desired window: a Chebyshev square of radius STREAM_RADIUS, clamped to
		// the finite world's chunk range.
		const desired = new Set<string>();
		for (let dz = -STREAM_RADIUS; dz <= STREAM_RADIUS; dz += 1) {
			for (let dx = -STREAM_RADIUS; dx <= STREAM_RADIUS; dx += 1) {
				const cx = pcx + dx;
				const cz = pcz + dz;
				if (cx < MIN_CHUNK || cx >= MAX_CHUNK || cz < MIN_CHUNK || cz >= MAX_CHUNK) {
					continue;
				}
				desired.add(chunkKey(cx, cz));
			}
		}

		// Send chunks that entered range.
		for (const key of desired) {
			if (loaded.has(key)) {
				continue;
			}
			const [cx, cz] = key.split(',').map(Number) as [number, number];
			const payload: ChunkPayload = { cx, cz, data: this.terrain.chunk(this.seed, cx, cz) };
			client.send(ServerMessage.Chunk, payload);
			loaded.add(key);
		}

		// Drop chunks that left range.
		for (const key of loaded) {
			if (desired.has(key)) {
				continue;
			}
			const [cx, cz] = key.split(',').map(Number) as [number, number];
			const payload: ChunkDropPayload = { cx, cz };
			client.send(ServerMessage.ChunkDrop, payload);
			loaded.delete(key);
		}
	}
}
