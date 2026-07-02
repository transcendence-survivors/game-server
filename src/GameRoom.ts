import { Client, Room } from 'colyseus';
// import { GameState, Player } from '@transcendence/game-shared';
import {
	applyHorizontalMovement,
	applyVerticalMovement,
	GameState,
	Player,
	resolveTerrainCollision,
} from '../../shared-package';
import {
	MAX_DT,
	MoveInput,
	MovementState,
	ACCESS_RADIUS,
	RAY_DIR_X,
	RAY_DIR_Z,
	RAY_SPEED,
	clampToRadius,
	World,
} from '../../shared-package';

export class GameRoom extends Room {
	private world!: World;

	onCreate() {
		this.state = new GameState();
		this.state.seed = Math.floor(Math.random() * 1e9);
		this.world = new World(Math.floor(this.state.seed));
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
				y: player.y,
				rotationY: player.rotationY,
				velocityY: player.velocityY,
				isGrounded: player.isGrounded,
			};
			const horizontalMove = applyHorizontalMovement(
				currentState,
				clampedInput,
				clampedInput.cameraYaw,
			);
			const groundHeight = this.world.height(
				horizontalMove.x,
				horizontalMove.z,
			);
			const verticalMove = applyVerticalMovement(
				currentState.y,
				currentState.velocityY,
				currentState.isGrounded,
				groundHeight,
				clampedInput,
			);
			let newState: MovementState = {
				x: horizontalMove.x,
				z: horizontalMove.z,
				rotationY: horizontalMove.rotationY,
				y: verticalMove.y,
				velocityY: verticalMove.velocityY,
				isGrounded: verticalMove.isGrounded,
			};
			const resolved = resolveTerrainCollision(
				this.world,
				{
					x: player.x,
					z: player.z,
				},
				{ x: newState.x, z: newState.z },
				player.y,
			);
			newState.x = resolved.x;
			newState.z = resolved.z;
			newState.y = Math.max(
				newState.y,
				this.world.height(newState.x, newState.z),
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
			newState.y = Math.max(newState.y, this.world.height(x, z));
			player.x = newState.x;
			player.y = newState.y;
			player.z = newState.z;
			player.rotationY = newState.rotationY;
			player.velocityY = newState.velocityY;
			player.isGrounded = newState.isGrounded;
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
