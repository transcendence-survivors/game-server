/**
 * @file Loads, validates and caches all data-driven game configs from disk.
 *
 * Single entry point — every other module reads gameplay parameters via
 * {@link loadConfig}. No magic numbers anywhere else in the codebase.
 *
 * Configs are loaded **once** on first call and frozen. To change values,
 * edit the JSON files in `src/data/` and restart the server.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Physical simulation parameters. Units: meters, seconds. */
export interface PhysicsConfig {
	/** Downward acceleration applied to airborne players (m/s²). */
	readonly gravity: number;
	/** Instantaneous upward velocity granted at jump start (m/s). */
	readonly jumpForce: number;
	/** Horizontal speed when an axis is fully held (m/s). */
	readonly moveSpeed: number;
	/** Y coordinate of a player's center when standing on the flat map. */
	readonly groundY: number;
}

/** Room-level parameters (capacity, simulation rate, spawn placement, lobby). */
export interface RoomConfig {
	/** Hard cap on connected clients per room instance. */
	readonly maxPlayers: number;
	/** Minimum ready players required before a lobby can auto-start the game. */
	readonly minPlayers: number;
	/** Server simulation rate in Hz (ticks per second). */
	readonly tickRate: number;
	/** State broadcast rate in Hz (how often diffs are pushed to clients). */
	readonly patchRate: number;
	/** Y coordinate at which new players spawn. */
	readonly spawnHeight: number;
	/** X-axis distance between consecutive spawn slots. */
	readonly spawnSpread: number;
	/** Maximum accepted length for a host-chosen room name (truncated beyond). */
	readonly maxRoomNameLength: number;
	/** Maximum accepted length for a player pseudonym (truncated beyond). */
	readonly maxPlayerNameLength: number;
	/** Minimum length the server accepts for a private room's password. */
	readonly minPasswordLength: number;
	/** Maximum accepted password length (caps work hashing an oversized input). */
	readonly maxPasswordLength: number;
}

/** Aggregate root for all server-side configuration. */
export interface GameConfig {
	readonly physics: PhysicsConfig;
	readonly room: RoomConfig;
}

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function readJson<T>(filename: string): T {
	const path = join(DATA_DIR, filename);
	const raw = readFileSync(path, 'utf-8');
	try {
		return JSON.parse(raw) as T;
	} catch (err) {
		throw new Error(`[ConfigLoader] Invalid JSON in ${path}: ${(err as Error).message}`);
	}
}

let cached: GameConfig | null = null;

/**
 * Returns the singleton {@link GameConfig}, loading from disk on first call.
 *
 * @throws if any JSON file is missing or malformed — startup must fail fast
 * rather than run with undefined gameplay values.
 */
export function loadConfig(): GameConfig {
	if (cached !== null) {
		return cached;
	}
	const config: GameConfig = {
		physics: readJson<PhysicsConfig>('physics.json'),
		room: readJson<RoomConfig>('room.json'),
	};
	cached = Object.freeze({
		physics: Object.freeze(config.physics),
		room: Object.freeze(config.room),
	});
	return cached;
}
