import type { Client } from 'colyseus';
import {
	type GameState,
	type MoveInput,
	type MovementState,
	World,
	MAX_DT,
	simulatePlayerMovement,
	normalizeAngle,
} from '../../shared-package/';

const MAX_SEQUENCE_ADVANCE = 120;
const MAX_MESSAGES_PER_SECOND = 120;
const MOVEMENT_BUDGET_CAP_S = MAX_DT * 2;

interface ClientInputState {
	windowStartedAtMs: number;
	windowMessages: number;
	lastAcceptedAtMs: number;
	movementBudgetS: number;
}

export class InputValidator {
	private readonly clients = new Map<string, ClientInputState>();

	constructor(
		private readonly world: World,
		private readonly roomState: GameState,
		private readonly now: () => number = Date.now,
	) {}

	validate(client: Pick<Client, 'sessionId'>, message: unknown): boolean {
		const player = this.roomState.players.get(client.sessionId);
		if (!player || player.life.isDepleted() || !this.isMoveInput(message))
			return false;
		if (
			message.seq <= player.lastProcessedSeq ||
			message.seq > player.lastProcessedSeq + MAX_SEQUENCE_ADVANCE
		)
			return false;

		const now = this.now();
		if (!Number.isFinite(now)) return false;
		const state = this.clientState(client.sessionId, now);
		if (now - state.windowStartedAtMs >= 1000) {
			state.windowStartedAtMs = now;
			state.windowMessages = 0;
		}
		if (state.windowMessages >= MAX_MESSAGES_PER_SECOND) return false;
		state.windowMessages++;

		const elapsedS = Math.max(0, (now - state.lastAcceptedAtMs) / 1000);
		state.movementBudgetS = Math.min(
			MOVEMENT_BUDGET_CAP_S,
			state.movementBudgetS + elapsedS,
		);
		const deltaTime = Math.min(
			message.deltaTime,
			MAX_DT,
			state.movementBudgetS,
		);
		if (deltaTime <= 0) return false;
		state.movementBudgetS -= deltaTime;
		state.lastAcceptedAtMs = now;

		const input: MoveInput = {
			...message,
			deltaTime,
			cameraYaw: normalizeAngle(message.cameraYaw),
		};
		const current: MovementState = {
			x: player.x,
			z: player.z,
			y: player.y,
			rotationY: player.rotationY,
			velocityY: player.velocityY,
			isGrounded: player.isGrounded,
		};
		const moving =
			input.forward || input.backward || input.right || input.left;
		const next = simulatePlayerMovement(
			this.world,
			current,
			input,
			player.stats.moveSpeed,
		);
		player.animState = moving ? 'moving' : 'idle';
		player.x = next.x;
		player.y = next.y;
		player.z = next.z;
		player.rotationY = next.rotationY;
		player.velocityY = next.velocityY;
		player.isGrounded = next.isGrounded;
		player.lastProcessedSeq = input.seq;
		return true;
	}

	removeClient(sessionId: string): void {
		this.clients.delete(sessionId);
	}

	private clientState(sessionId: string, now: number): ClientInputState {
		let state = this.clients.get(sessionId);
		if (!state) {
			state = {
				windowStartedAtMs: now,
				windowMessages: 0,
				lastAcceptedAtMs: now,
				movementBudgetS: MAX_DT,
			};
			this.clients.set(sessionId, state);
		}
		return state;
	}

	private isMoveInput(value: unknown): value is MoveInput {
		if (!value || typeof value !== 'object') return false;
		const input = value as Record<string, unknown>;
		return (
			Number.isSafeInteger(input.seq) &&
			(input.seq as number) > 0 &&
			Number.isFinite(input.deltaTime) &&
			(input.deltaTime as number) > 0 &&
			Number.isFinite(input.cameraYaw) &&
			['forward', 'backward', 'right', 'left', 'jump'].every(
				(key) => typeof input[key] === 'boolean',
			)
		);
	}
}
