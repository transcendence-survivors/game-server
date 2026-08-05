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
	resolveTerrainCollision,
} from '../../shared-package/';
import { groundHeightUnderHitbox } from '../../shared-package/src/gameplay/Collisions';

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
		this.player = this.roomState.players.get(client.sessionId);
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
			this.player.stats.moveSpeed,
		);
		const groundHeight = groundHeightUnderHitbox(
			this.world,
			this.player.x,
			this.player.z,
		);
		this.verticalMove = applyVerticalMovement(
			this.currentState.y,
			this.currentState.velocityY,
			this.currentState.isGrounded,
			groundHeight,
			this.clampedInput,
		);
		this.resolved = resolveTerrainCollision(
			this.world,
			{
				x: this.player.x,
				z: this.player.z,
			},
			{ x: this.horizontalMove.x, z: this.horizontalMove.z },
			this.verticalMove.y,
		);
		const finalGroundHeight = groundHeightUnderHitbox(
			this.world,
			this.resolved.x,
			this.resolved.z,
		);
		if (this.verticalMove.y <= finalGroundHeight) {
			this.verticalMove.y = finalGroundHeight;
			this.verticalMove.velocityY = 0;
			this.verticalMove.isGrounded = true;
		}
		this.newState = {
			x: this.resolved.x,
			z: this.resolved.z,
			rotationY: this.horizontalMove.rotationY,
			y: this.verticalMove.y,
			velocityY: this.verticalMove.velocityY,
			isGrounded: this.verticalMove.isGrounded,
		};
	}

	validate(client: Client, message: MoveInput) {
		this.update(client, message);
		this.player.animState = this.moving ? 'moving' : 'idle';

		this.newState.y = Math.max(
			this.newState.y,
			groundHeightUnderHitbox(
				this.world,
				this.newState.x,
				this.newState.z,
			),
		);
		this.player.x = this.newState.x;
		this.player.y = this.newState.y;
		this.player.z = this.newState.z;
		this.player.rotationY = this.newState.rotationY;
		this.player.velocityY = this.newState.velocityY;
		this.player.isGrounded = this.newState.isGrounded;
		this.player.lastProcessedSeq = this.clampedInput.seq;
	}
}
