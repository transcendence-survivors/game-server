import { Client, matchMaker, room, Room } from 'colyseus';
import {
	World,
	GameState,
	RAY_DIR_X,
	RAY_DIR_Z,
	RAY_SPEED,
	MoveInput,
	Player,
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
		if (alreadyExists.find((r) => r.metadata?.roomName === roomName)) {
			throw new Error('Room already exists');
		}
		await this.setMetadata({ roomName });
		this.maxClients = 4;
		this.state = new GameState() as GameState;
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
