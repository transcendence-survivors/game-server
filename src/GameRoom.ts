import { Client, matchMaker, room, Room } from 'colyseus';
import {
	World,
	GameState,
	RAY_DIR_X,
	RAY_DIR_Z,
	RAY_SPEED,
	MoveInput,
	Player,
	clampToRadius,
	ACCESS_RADIUS,
} from '../../shared-package';
import { InputValidator } from './InputValidator';

interface GameRoomOptions {
	roomName: string;
}

export class GameRoom extends Room {
	private world!: World;
	private inputValidator!: InputValidator;

	async onCreate(options: GameRoomOptions) {
		const roomName = options?.roomName?.trim().toLowerCase();

		const existing = matchMaker.query({ name: 'game_room' });
		const alreadyExists = await existing;
		alreadyExists.find((r) => {
			r.metadata?.roomName === roomName;
		});
		this.setMetadata({ roomName });
		this.state = new GameState();
		this.state.seed = Math.floor(Math.random() * 1e9);
		this.world = new World(Math.floor(this.state.seed));
		this.inputValidator = new InputValidator(this.world, this.state);
		this.setSimulationInterval((dt) => {
			this.state.rayX += RAY_DIR_X * RAY_SPEED * (dt / 1000);
			this.state.rayZ += RAY_DIR_Z * RAY_SPEED * (dt / 1000);
			this.state.rayY = this.world.height(
				this.state.rayX,
				this.state.rayZ,
			);
			// for (const player of this.state.players.values()) {
			// 	const { x, z } = clampToRadius(
			// 		player.x,
			// 		player.z,
			// 		this.state.rayX,
			// 		this.state.rayZ,
			// 		ACCESS_RADIUS,
			// 	);
			// 	if (x !== player.x || z !== player.z) {
			// 		player.x = x;
			// 		player.z = z;
			// 		player.y = this.world.height(x, z);
			// 	}
			// }
		}, 1000 / 20);
		this.onMessage('move', (client: Client, message: MoveInput) => {
			this.inputValidator.validate(client, message);
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
