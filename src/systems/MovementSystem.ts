/**
 * @file Translates per-player input into horizontal velocity.
 *
 * Runs first in the tick pipeline, before {@link PhysicsSystem}. Stateless —
 * the system only reads inputs from {@link Player} and writes velocity back to
 * the same instance.
 */

import type { PhysicsConfig } from '../core/ConfigLoader';
import type { GameState } from '../schemas/GameState';

export class MovementSystem {
	constructor(private readonly physics: PhysicsConfig) {}

	/**
	 * For every player, clamp & normalize their latest input axes and convert
	 * them into world-space velocity.
	 *
	 * Diagonal input is normalized so moving NE is not √2× faster than moving N.
	 *
	 * @param state - Mutable room state.
	 * @param _dt - Tick delta in seconds. Unused here (movement is rate-limited
	 *   by `moveSpeed`, not integrated), kept for system-interface symmetry.
	 */
	update(state: GameState, _dt: number): void {
		for (const player of state.players.values()) {
			const mx = clamp(player.inputMoveX, -1, 1);
			const mz = clamp(player.inputMoveZ, -1, 1);
			const len = Math.hypot(mx, mz);
			const nx = len > 1 ? mx / len : mx;
			const nz = len > 1 ? mz / len : mz;
			player.vx = nx * this.physics.moveSpeed;
			player.vz = nz * this.physics.moveSpeed;
		}
	}
}

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}
