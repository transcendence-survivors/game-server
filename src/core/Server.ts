/**
 * @file Bootstraps the Colyseus server with the Bun WebSocket transport.
 *
 * Responsibilities:
 * - Build the {@link Server} with the right transport.
 * - Register every room under its canonical {@link ROOM_NAME}.
 * - Start listening on the given port.
 *
 * Adding a new room type? Define it under `src/rooms/`, then register it here.
 */

import { BunWebSockets } from '@colyseus/bun-websockets';
import { Server } from 'colyseus';
import { ROOM_NAME } from '@transcendence/game-shared';

import { GameRoom } from '../rooms/GameRoom';

/**
 * Build and start the game server.
 *
 * @param port - TCP port to bind. Pass `0` to let the OS choose (tests only).
 * @returns the running {@link Server} instance — keep a reference if you need
 *   to call `gracefullyShutdown()` later.
 */
export function createGameServer(port: number): Server {
	const transport = new BunWebSockets({});
	const server = new Server({ transport });

	server.define(ROOM_NAME, GameRoom);

	server.listen(port);
	return server;
}
