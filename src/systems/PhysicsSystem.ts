/**
 * @file Applies gravity, jump impulses, integration and terrain collision.
 *
 * Runs after {@link MovementSystem} in the tick pipeline. The map is a
 * Minecraft-style heightmap: there is no XZ wall collision (players roam the
 * horizontal plane freely), but the ground each player rests on follows the
 * procedurally-generated terrain surface beneath them. Horizontal motion is also
 * clamped to the finite world bounds.
 */

import { HALF_WORLD } from '@transcendence/game-shared';

import type { PhysicsConfig } from '../core/ConfigLoader';
import type { GameState } from '../schemas/GameState';

/** Samples the terrain surface height (in blocks) at a world column. */
export type HeightSampler = (wx: number, wz: number) => number;

export class PhysicsSystem {
	/**
	 * @param physics - Gravity / jump / ground-offset parameters.
	 * @param sampleHeight - Terrain surface height at a world column. The player
	 *   rests with its centre `physics.groundY` above this surface.
	 */
	constructor(
		private readonly physics: PhysicsConfig,
		private readonly sampleHeight: HeightSampler,
	) {}

	/**
	 * Step the physical simulation forward by `dt` seconds.
	 *
	 * Order per player: consume jump request → apply gravity → integrate position
	 * → clamp to world bounds → resolve terrain-surface collision.
	 */
	update(state: GameState, dt: number): void {
		const { gravity, jumpForce, groundY } = this.physics;
		// Keep the centre strictly inside the world so the sampled block index
		// never lands on the exclusive upper bound.
		const limit = HALF_WORLD - 1;

		for (const player of state.players.values()) {
			if (player.inputJump && player.isGrounded) {
				player.vy = jumpForce;
				player.isGrounded = false;
			}
			player.inputJump = false;

			player.vy -= gravity * dt;

			player.x += player.vx * dt;
			player.y += player.vy * dt;
			player.z += player.vz * dt;

			if (player.x < -limit) player.x = -limit;
			else if (player.x > limit) player.x = limit;
			if (player.z < -limit) player.z = -limit;
			else if (player.z > limit) player.z = limit;

			// Ground = terrain surface under the player + the centre offset.
			const floorY = this.sampleHeight(player.x, player.z) + groundY;
			if (player.y <= floorY) {
				player.y = floorY;
				player.vy = 0;
				player.isGrounded = true;
			}
		}
	}
}
