/**
 * @file Root Colyseus schema for the game room.
 *
 * Anything reachable from this object graph gets automatically synced to every
 * connected client. New top-level concepts (enemies, projectiles, …) should be
 * added as new `@type`-decorated fields here.
 */

import { MapSchema, Schema, type } from '@colyseus/schema';
import { Player } from './Player';

export class GameState extends Schema {
	/**
	 * Monotonically increasing simulation tick number, bumped once per
	 * `setSimulationInterval` callback.
	 *
	 * Exposed in the state so clients can render server-side throughput (and
	 * detect stalls — a constant value over time means the simulation stopped).
	 */
	@type('number') tick: number = 0;

	/**
	 * All connected players keyed by their `sessionId`.
	 *
	 * Using {@link MapSchema} gives Colyseus per-entry add/remove notifications
	 * on the client, which the client uses to spawn/despawn cubes.
	 */
	@type({ map: Player }) players = new MapSchema<Player>();
}
