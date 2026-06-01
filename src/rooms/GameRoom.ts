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
import { ClientMessage, type InputCommand } from '@transcendence/game-shared';

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

		const tickMs = 1000 / this.config.room.tickRate;
		this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), tickMs);
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
	}

	private tick(dt: number): void {
		this.movement.update(this.state, dt);
		this.physics.update(this.state, dt);
	}
}
