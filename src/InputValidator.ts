import { Client } from 'colyseus';
import {
	type MoveInput,
	type MovementState,
	World,
	MAX_DT,
	applyHorizontalMovement,
	applyVerticalMovement,
	HorizontalMove,
	VerticalMove,
	clampToRadius,
	resolveTerrainCollision,
	ACCESS_RADIUS,
} from '../../shared-package/';

export class InputValidator {
	private player!: any;
	private moving!: boolean;
	private currentState!: MovementState;
	private newState!: MovementState;
	private world!: World;
	private clampedInput!: MoveInput;
	private horizontalMove!: HorizontalMove;
	private verticalMove!: VerticalMove;
	private roomState!: any;
	private resolved!: {
		x: number;
		z: number;
	};

	constructor(world: World, roomState: any) {
		this.world = world;
		this.roomState = roomState;
	}

	update(client: Client, message: MoveInput) {
		this.player = this.state.players.get(client.sessionId);
		if (!this.player) return;

		this.clampedInput = {
			...message,
			deltaTime: Math.min(Math.max(message.deltaTime, 0), MAX_DT),
		};
		this.moving =
			this.clampedInput.forward ||
			this.clampedInput.backward ||
			this.clampedInput.right ||
			this.clampedInput.left;
		this.currentState = {
			x: this.player.x,
			z: this.player.z,
			y: this.player.y,
			rotationY: this.player.rotationY,
			velocityY: this.player.velocityY,
			isGrounded: this.player.isGrounded,
		};
		this.horizontalMove = applyHorizontalMovement(
			this.currentState,
			this.clampedInput,
			this.clampedInput.cameraYaw,
		);
		this.resolved = resolveTerrainCollision(
			this.world,
			{
				x: this.player.x,
				z: this.player.z,
			},
			{ x: this.horizontalMove.x, z: this.horizontalMove.z },
			this.player.y,
		);
		const groundHeight = this.world.height(
			this.resolved.x,
			this.resolved.z,
		);
		this.verticalMove = applyVerticalMovement(
			this.currentState.y,
			this.currentState.velocityY,
			this.currentState.isGrounded,
			groundHeight,
			this.clampedInput,
		);
		this.newState = {
			x: this.horizontalMove.x,
			z: this.horizontalMove.z,
			rotationY: this.horizontalMove.rotationY,
			y: this.verticalMove.y,
			velocityY: this.verticalMove.velocityY,
			isGrounded: this.verticalMove.isGrounded,
		};
	}

	validate(client: Client, message: MoveInput) {
		if (!this.player) return;
		this.update(client, message);
		this.player.animState = this.moving ? 'moving' : 'idle';

		this.newState.y = Math.max(
			this.newState.y,
			this.world.height(this.newState.x, this.newState.z),
		);
		const { x, z } = clampToRadius(
			this.newState.x,
			this.newState.z,
			this.roomState.rayX,
			this.roomState.rayZ,
			ACCESS_RADIUS,
		);
		this.newState.x = x;
		this.newState.z = z;
		this.newState.y = Math.max(this.newState.y, this.world.height(x, z));
		this.player.x = this.newState.x;
		this.player.y = this.newState.y;
		this.player.z = this.newState.z;
		this.player.rotationY = this.newState.rotationY;
		this.player.velocityY = this.newState.velocityY;
		this.player.isGrounded = this.newState.isGrounded;
		this.player.lastProcessedSeq = this.clampedInput.seq;
	}
}
