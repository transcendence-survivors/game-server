import { Client, Room } from 'colyseus';
// import { GameState, Player } from '@transcendence/game-shared';
import { GameState, Player } from '../../shared-package';
import {
	applyMovement,
	MAX_DT,
	MoveInput,
	MovementState,
} from '../../shared-package';

export class GameRoom extends Room {
	onCreate() {
		this.state = new GameState();
		this.onMessage('move', (client: Client, message: MoveInput) => {
			// your existing move logic
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
			const newState = applyMovement(currentState, clampedInput);
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
	}

	onLeave(client: Client) {
		this.state.players.delete(client.sessionId);
	}

	onDispose() {}
}
