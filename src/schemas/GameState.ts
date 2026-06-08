/**
 * @file Root Colyseus schema for the game room.
 *
 * Anything reachable from this object graph gets automatically synced to every
 * connected client. New top-level concepts (enemies, projectiles, …) should be
 * added as new `@type`-decorated fields here.
 */

import { MapSchema, Schema, type } from '@colyseus/schema';
import { RoomPhase } from '@transcendence/game-shared';
import { Player } from './Player';

export class GameState extends Schema {
	/**
	 * Current lifecycle phase: `lobby` while players gather and ready up, then
	 * `playing` once everyone is ready and the simulation starts. The client
	 * switches screens (waiting room → 3D scene) when this flips.
	 */
	@type('string') phase: string = RoomPhase.Lobby;

	/**
	 * `sessionId` of the host — the first player to join. The host is the only
	 * client allowed to kick others. Reassigned to the next player if the host
	 * leaves while still in the lobby. Empty until the first join.
	 */
	@type('string') hostId: string = '';

	/** Host-chosen display name of the game, shown in the lobby and listing. */
	@type('string') roomName: string = '';

	/** Visibility mode (`public` / `private`), echoed for the lobby UI. */
	@type('string') mode: string = '';

	/**
	 * Monotonically increasing simulation tick number, bumped once per
	 * `setSimulationInterval` callback.
	 *
	 * Exposed in the state so clients can render server-side throughput (and
	 * detect stalls — a constant value over time means the simulation stopped).
	 * Stays at 0 until the game leaves the lobby phase.
	 */
	@type('number') tick: number = 0;

	/**
	 * Procedural world seed for this room, chosen once at creation. Drives the
	 * authoritative `terrain-gen` chunk generation; broadcast so clients can read
	 * it (terrain itself is streamed as chunks, not regenerated client-side).
	 */
	@type('number') seed: number = 0;

	/**
	 * All connected players keyed by their `sessionId`.
	 *
	 * Using {@link MapSchema} gives Colyseus per-entry add/remove notifications
	 * on the client, which the client uses to spawn/despawn cubes.
	 */
	@type({ map: Player }) players = new MapSchema<Player>();
}
