/**
 * @file Applies gravity, jump impulses, integration and ground collision.
 *
 * Runs after {@link MovementSystem} in the tick pipeline. The flat map is
 * modeled as an infinite plane at `y = physics.groundY`; no XZ collision.
 */

import type { PhysicsConfig } from '../core/ConfigLoader';
import type { GameState } from '../schemas/GameState';

export class PhysicsSystem {
	constructor(private readonly physics: PhysicsConfig) {}

	/**
	 * Step the physical simulation forward by `dt` seconds.
	 *
	 * Order per player: consume jump request → apply gravity → integrate
	 * position → resolve ground collision.
	 */
	update(state: GameState, dt: number): void {
		const { gravity, jumpForce, groundY } = this.physics;

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

			if (player.y <= groundY) {
				player.y = groundY;
				player.vy = 0;
				player.isGrounded = true;
			}
		}
	}
}
