/**
 * @file Colyseus schema for a single player.
 *
 * Fields decorated with `@type(...)` are serialized and broadcast to all clients
 * on every change. Non-decorated fields are **server-only** runtime state
 * (velocity, latest input, etc.) — they exist on the same instance for
 * convenience but never leave the server process.
 */

import { Schema, type } from '@colyseus/schema';

export class Player extends Schema {
	// -------------------------- Synced (broadcast) --------------------------

	/** Stable session id, equals the Colyseus `client.sessionId`. */
	@type('string') id: string = '';

	/** Authoritative world position X (meters). */
	@type('number') x: number = 0;
	/** Authoritative world position Y — height above ground (meters). */
	@type('number') y: number = 0;
	/** Authoritative world position Z (meters). */
	@type('number') z: number = 0;

	/**
	 * Latest round-trip latency reported by this player's own client, in ms.
	 *
	 * The server never measures this itself — it only echoes Ping with Pong and
	 * writes whatever the client reports back via ReportLatency (clamped to a
	 * sane range to keep the panel honest). Zero means "no measurement yet".
	 */
	@type('number') latencyMs: number = 0;

	// -------------------------- Server-only state ---------------------------

	/** Velocity X (m/s). Computed by {@link MovementSystem}. */
	vx: number = 0;
	/** Velocity Y (m/s). Computed by {@link PhysicsSystem}. */
	vy: number = 0;
	/** Velocity Z (m/s). Computed by {@link MovementSystem}. */
	vz: number = 0;

	/** True when the player is on the ground (jump is only allowed then). */
	isGrounded: boolean = true;

	/** Most recent horizontal input X from the client, in `[-1, 1]`. */
	inputMoveX: number = 0;
	/** Most recent horizontal input Z from the client, in `[-1, 1]`. */
	inputMoveZ: number = 0;
	/**
	 * Pending jump request. Set by the input handler, consumed by
	 * {@link PhysicsSystem} on the next tick. Reset to `false` after consumption
	 * so a single jump press cannot trigger multiple jumps.
	 */
	inputJump: boolean = false;
}
