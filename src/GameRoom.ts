import { Client, Room } from 'colyseus';
// import { GameState, Player } from '@transcendence/game-shared';
import { GameState, Player } from '../../shared-package';
import {
	applyMovement,
	MAX_DT,
	MoveInput,
	MovementState,
	ACCESS_RADIUS,
	RAY_DIR_X,
	RAY_DIR_Z,
	RAY_SPEED,
	clampToRadius,
} from '../../shared-package';
import { World } from '../../client/src/map/world';

export class GameRoom extends Room {
	private world!: World;
	onCreate() {
		this.state = new GameState();
		this.world = new World(Math.floor(Math.random() * 1e9));
		this.setSimulationInterval((dt) => {
			this.state.rayX += RAY_DIR_X * RAY_SPEED * (dt / 1000);
			this.state.rayZ += RAY_DIR_Z * RAY_SPEED * (dt / 1000);
			this.state.rayY = this.world.height(
				this.state.rayX,
				this.state.rayZ,
			);
		}, 1000 / 20);
		this.onMessage('move', (client: Client, message: MoveInput) => {
			const player = this.state.players.get(client.sessionId);
			if (!player) return;
			const clampedInput: MoveInput = {
				...message,
				deltaTime: Math.min(Math.max(message.deltaTime, 0), MAX_DT),
			};
			const moving =
				clampedInput.forward ||
				clampedInput.backward ||
				clampedInput.right ||
				clampedInput.left;
			player.animState = moving ? 'moving' : 'idle';
			const currentState: MovementState = {
				x: player.x,
				z: player.z,
				rotationY: player.rotationY,
			};
			let newState = applyMovement(
				currentState,
				clampedInput,
				clampedInput.cameraYaw,
			);
			const { x, z } = clampToRadius(
				newState.x,
				newState.z,
				this.state.rayX,
				this.state.rayZ,
				ACCESS_RADIUS,
			);
			newState.x = x;
			newState.z = z;
			player.y = this.world.height(newState.x, newState.z);
			const allowed = true;
			if (allowed) {
				player.x = newState.x;
				player.z = newState.z;
				player.rotationY = newState.rotationY;
			}
			player.lastProcessedSeq = clampedInput.seq;
		});
	}

	onJoin(client: Client) {
		this.state.players.set(client.sessionId, new Player());
		client.send('worldSeed', { seed: this.world.seed });
	}

	onLeave(client: Client) {
		this.state.players.delete(client.sessionId);
	}

	onDispose() {}
}
