/**
 * @file Bootstraps the Colyseus server with the Bun WebSocket transport.
 *
 * Responsibilities:
 * - Build the {@link Server} with the right transport.
 * - Register the {@link GameRoom} (matchable by `roomName`, listed in real time)
 *   and the {@link PublicLobbyRoom} that streams the public room directory.
 * - Start listening on the given port.
 *
 * Adding a new room type? Define it under `src/rooms/`, then register it here.
 */

import { BunWebSockets } from '@colyseus/bun-websockets';
import { Server } from 'colyseus';
import { LOBBY_NAME, ROOM_NAME } from '@transcendence/game-shared';

import { GameRoom } from '../rooms/GameRoom';
import { PublicLobbyRoom } from '../rooms/PublicLobbyRoom';

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

	// `filterBy(['roomName'])` lets a private join resolve a room by its name;
	// `enableRealtimeListing()` pushes create/join/leave/dispose events to the
	// LobbyRoom so the "find a game" browser updates live.
	server.define(ROOM_NAME, GameRoom).filterBy(['roomName']).enableRealtimeListing();
	server.define(LOBBY_NAME, PublicLobbyRoom);

	server.listen(port);
	return server;
}
