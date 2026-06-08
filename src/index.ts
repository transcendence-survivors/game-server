/**
 * @file Bun entry point — loads config, starts the server, logs readiness.
 *
 * Run with `bun --watch src/index.ts` in development.
 */

import { loadConfig } from './core/ConfigLoader';
import { createGameServer } from './core/Server';

// `|| 4000` (not `??`) so an empty/blank PORT — e.g. a missing `.env` leaving
// `${GAME_SERVER_PORT}` unsubstituted — falls back to 4000 instead of becoming
// `Number('') === 0`, which would make the OS pick a random, unreachable port.
const PORT = Number(process.env.PORT) || 4000;

// Load and validate config first so we crash early on a malformed JSON.
const config = loadConfig();
console.log(
	`[server] config loaded — tickRate=${config.room.tickRate}Hz, maxPlayers=${config.room.maxPlayers}`,
);

createGameServer(PORT);
console.log(`[server] listening on :${PORT}`);
