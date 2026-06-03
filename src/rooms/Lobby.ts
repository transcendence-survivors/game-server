/**
 * @file Pure helpers for the lobby phase of a {@link GameRoom}.
 *
 * These functions contain the lobby's decision logic with **no Colyseus
 * dependency** beyond the state schema they read/write, so they stay trivially
 * unit-testable (vitest) and keep `GameRoom` a thin orchestration layer — same
 * discipline as the gameplay `systems/`.
 */

import type { RoomConfig } from '../core/ConfigLoader';
import type { GameState } from '../schemas/GameState';

/**
 * True for ASCII control characters (C0 range `0x00`–`0x1F` plus DEL `0x7F`),
 * which we scrub from untrusted display strings before storing them.
 */
function isControlChar(code: number): boolean {
	return code < 0x20 || code === 0x7f;
}

/**
 * Normalize an untrusted display string from a client.
 *
 * Drops control characters, collapses inner whitespace runs to single spaces,
 * trims, and truncates to `maxLen`. Returns `fallback` when the result would be
 * empty so the roster never shows a blank entry.
 *
 * @param raw - The client-supplied value (may be `undefined`/non-string).
 * @param maxLen - Maximum length to keep.
 * @param fallback - Value to use when `raw` sanitizes to empty.
 */
export function sanitizeName(raw: unknown, maxLen: number, fallback: string): string {
	if (typeof raw !== 'string') {
		return fallback;
	}
	let out = '';
	for (const ch of raw) {
		if (!isControlChar(ch.charCodeAt(0))) {
			out += ch;
		}
	}
	const cleaned = out.replace(/\s+/g, ' ').trim();
	if (cleaned.length === 0) {
		return fallback;
	}
	return cleaned.slice(0, maxLen);
}

/**
 * Whether the lobby satisfies its auto-start condition: at least `minPlayers`
 * present **and** every present player has toggled ready.
 *
 * An empty room (or one below the minimum) never auto-starts.
 */
export function everyoneReady(state: GameState, minPlayers: number): boolean {
	if (state.players.size < minPlayers) {
		return false;
	}
	for (const player of state.players.values()) {
		if (!player.ready) {
			return false;
		}
	}
	return true;
}

/**
 * Place every player at a distinct spawn slot spread along the X axis, centred
 * on the origin. Called once when the game leaves the lobby so positions are
 * only assigned to the players who actually made it into the match.
 *
 * Mirrors the spread formula previously inlined in `GameRoom.onJoin`.
 */
export function assignSpawns(state: GameState, config: RoomConfig): void {
	let slot = 0;
	for (const player of state.players.values()) {
		player.x = (slot - (config.maxPlayers - 1) / 2) * config.spawnSpread;
		player.y = config.spawnHeight;
		player.z = 0;
		slot += 1;
	}
}

/**
 * Pick the `sessionId` that should become host after the current host leaves.
 *
 * Returns the first remaining player's id (insertion order), or an empty string
 * when the room is now empty.
 */
export function nextHostId(state: GameState): string {
	for (const sessionId of state.players.keys()) {
		return sessionId;
	}
	return '';
}
