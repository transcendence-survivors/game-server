import { Client, matchMaker, room, Room } from 'colyseus';
import {
	World,
	GameState,
	RAY_DIR_X,
	RAY_DIR_Z,
	RAY_SPEED,
	MoveInput,
	AttackInput,
	Player,
	PLAYER_ATTACK_DAMAGE,
	ACCESS_RADIUS,
	findSpawnPoint,
} from '../../shared-package';
import { InputValidator } from './InputValidator';
import { CombatManager } from './CombatManager';
import { MonsterManager } from './MonsterManager';

interface GameRoomOptions {
	roomName: string;
}

export class GameRoom extends Room<{ state: GameState }> {
	private world!: World;
	private inputValidator!: InputValidator;
	private combatManager!: CombatManager;
	private monsterManager!: MonsterManager;

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
		this.combatManager = new CombatManager(this.state);
		this.monsterManager = new MonsterManager(
			this.world,
			this.state,
			this.combatManager,
		);
		this.setSimulationInterval((dt) => {
			this.monsterManager.update(dt / 1000);
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
		this.onMessage('attack', (client: Client, message: AttackInput) => {
			if (typeof message?.monsterId !== 'string') return;
			this.combatManager.damageMonster(
				client,
				message.monsterId,
				PLAYER_ATTACK_DAMAGE,
			);
		});
	}

	onJoin(client: Client) {
		// Le joueur doit apparaître sur une zone dégagée du rayon d'accès
		// (autour du faisceau) et jamais enterré dans un mur. On disperse
		// légèrement les joueurs pour qu'ils ne se superposent pas au spawn.
		const index = this.state.players.size; // 0..3
		const spread = index === 0 ? 0 : this.world.CELL * 2;
		const angle = index * (Math.PI / 2);
		const spawn = findSpawnPoint(
			this.world,
			this.state.rayX + Math.cos(angle) * spread,
			this.state.rayZ + Math.sin(angle) * spread,
			this.state.rayX,
			this.state.rayZ,
			ACCESS_RADIUS,
		);
		const player = new Player();
		player.x = spawn.x;
		player.y = spawn.y;
		player.z = spawn.z;
		this.state.players.set(client.sessionId, player);
		client.send('worldSeed', { seed: this.world.seed });
	}

	onLeave(client: Client) {
		this.state.players.delete(client.sessionId);
	}

	onDispose() {}
}
