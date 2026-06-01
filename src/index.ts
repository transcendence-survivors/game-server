/**
 * @file Bun entry point — loads config, starts the server, logs readiness.
 *
 * Run with `bun --watch src/index.ts` in development.
 */

import { loadConfig } from './core/ConfigLoader';
import { createGameServer } from './core/Server';

const PORT = Number(process.env.PORT ?? 4000);

// Load and validate config first so we crash early on a malformed JSON.
const config = loadConfig();
console.log(
	`[server] config loaded — tickRate=${config.room.tickRate}Hz, maxPlayers=${config.room.maxPlayers}`,
);

createGameServer(PORT);
console.log(`[server] listening on :${PORT}`);
