import { Client, matchMaker, Room } from 'colyseus';
import {
	World,
	GameState,
	RAY_DIR_X,
	RAY_DIR_Z,
	RAY_SPEED,
	MoveInput,
	Player,
	ACCESS_RADIUS,
	findSpawnPoint,
	rollUpgradeOptions,
	applyUpgrade,
	ClientMessage,
	ServerMessage,
	WeaponState,
	type SelectUpgradeInput,
	weaponConfigRegistry,
	type UpgradeDef,
} from '../../shared-package';
import { InputValidator } from './InputValidator';
import { MonsterManager } from './MonsterManager';
import { DamageResolver } from './combat/DamageResolver';
import { KillRewardSystem } from './combat/KillRewardSystem';
import { CombatEntitySystem } from './combat/CombatEntitySystem';
import { CombatSystem } from './combat/CombatSystem';
import { createWeaponFactory } from './combat/createWeaponFactory';

interface GameRoomOptions {
	roomName: string;
}

export class GameRoom extends Room<{ state: GameState }> {
	private world!: World;
	private inputValidator!: InputValidator;
	private damageResolver!: DamageResolver;
	private monsterManager!: MonsterManager;
	private combatSystem!: CombatSystem;
	private combatEntitySystem!: CombatEntitySystem;
	private pendingOffers = new Map<string, UpgradeDef[]>();
	private upgradeRollSequences = new Map<string, number>();
	private availableUpgradeChoices = new Map<string, number>();

	async onCreate(options: GameRoomOptions) {
		const roomName = options?.roomName?.trim().toLowerCase();
		console.log(`Creating game room with name: ${roomName}`);
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
		const killRewards = new KillRewardSystem(
			this.state,
			this.clients,
			(playerId, levelsGained) => {
				this.availableUpgradeChoices.set(
					playerId,
					(this.availableUpgradeChoices.get(playerId) ?? 0) +
						levelsGained,
				);
			},
		);
		this.damageResolver = new DamageResolver(this.state, killRewards);
		this.monsterManager = new MonsterManager(
			this.world,
			this.state,
			this.damageResolver,
		);
		this.combatEntitySystem = new CombatEntitySystem(
			this.state,
			this.damageResolver,
			(x, z) => this.world.height(x, z),
		);
		const weaponFactory = createWeaponFactory();
		this.combatSystem = new CombatSystem(
			this.state,
			this.damageResolver,
			weaponFactory,
			this.combatEntitySystem,
		);
		this.setSimulationInterval((dt) => {
			this.monsterManager.update(dt / 1000);
			this.combatSystem.update(dt / 1000);
			this.combatEntitySystem.update(dt / 1000);
			const damage = this.damageResolver.drainImpactEvents();
			if (damage.length)
				this.broadcast(ServerMessage.MonsterDamage, damage);
			this.state.rayX += RAY_DIR_X * RAY_SPEED * (dt / 1000);
			this.state.rayZ += RAY_DIR_Z * RAY_SPEED * (dt / 1000);
			this.state.rayY = this.world.height(
				this.state.rayX,
				this.state.rayZ,
			);
			this.state.players.forEach((player, sessionId) => {
				const client = this.clients.find(
					(c) => c.sessionId === sessionId,
				);
				if (client && player.life.isDepleted()) {
					client.send(ServerMessage.GameOver, {
						playerId: sessionId,
					});
				}
			});
		}, 1000 / 20);
		this.onMessage(
			ClientMessage.Move,
			(client: Client, message: MoveInput) => {
				this.inputValidator.validate(client, message);
			},
		);
		this.onMessage(
			ClientMessage.SetDebugImmortal,
			(client: Client, message: unknown) => {
				const player = this.state.players.get(client.sessionId);
				if (
					!player ||
					typeof message !== 'object' ||
					message === null ||
					typeof (message as { enabled?: unknown }).enabled !==
						'boolean'
				)
					return;
				player.debugImmortal = (
					message as { enabled: boolean }
				).enabled;
			},
		);
		this.onMessage(ClientMessage.RequestUpgradeOptions, (client) => {
			const player = this.state.players.get(client.sessionId);
			if (
				!player ||
				player.life.isDepleted() ||
				(this.availableUpgradeChoices.get(client.sessionId) ?? 0) <= 0
			)
				return;
			const pending = this.pendingOffers.get(client.sessionId);
			if (pending) {
				this.sendUpgradeOptions(client, pending);
				return;
			}

			const sequence =
				(this.upgradeRollSequences.get(client.sessionId) ?? 0) + 1;
			this.upgradeRollSequences.set(client.sessionId, sequence);
			let randomState = this.state.seed ^ sequence;
			for (const character of client.sessionId)
				randomState = Math.imul(
					randomState ^ character.charCodeAt(0),
					16777619,
				);
			const random = () => {
				randomState =
					(Math.imul(randomState, 1664525) + 1013904223) | 0;
				return (randomState >>> 0) / 4294967296;
			};
			const options = rollUpgradeOptions(player, 3, random);
			this.pendingOffers.set(client.sessionId, options);

			this.sendUpgradeOptions(client, options);
		});

		this.onMessage(
			ClientMessage.SelectUpgrade,
			(client, message: SelectUpgradeInput) => {
				const player = this.state.players.get(client.sessionId);
				if (
					!player ||
					player.life.isDepleted() ||
					!message ||
					typeof message.id !== 'string' ||
					message.id.length > 64
				)
					return;

				const offered = this.pendingOffers.get(client.sessionId);
				const upgrade = offered?.find(
					(option) => option.id === message.id,
				);
				if (!upgrade) {
					console.warn(
						`${client.sessionId} tried to select invalid upgrade: ${message.id}`,
					);
					return;
				}
				if (!applyUpgrade(player, upgrade)) return;
				this.pendingOffers.delete(client.sessionId);
				this.availableUpgradeChoices.set(
					client.sessionId,
					Math.max(
						0,
						(this.availableUpgradeChoices.get(client.sessionId) ??
							0) - 1,
					),
				);
			},
		);
	}

	onJoin(client: Client) {
		console.log(`Client ${client.sessionId} `);

		const index = this.state.players.size;
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
		player.aura.radius = 0;
		for (const kind of ['axe'] as const) {
			const weapon = new WeaponState();
			weapon.kind = weaponConfigRegistry.get(kind).kind;
			player.weapons.set(weapon.kind, weapon);
		}
		player.x = spawn.x;
		player.y = spawn.y;
		player.z = spawn.z;
		this.state.players.set(client.sessionId, player);
		client.send(ServerMessage.WorldSeed, { seed: this.world.seed });
	}

	onLeave(client: Client) {
		this.pendingOffers.delete(client.sessionId);
		this.upgradeRollSequences.delete(client.sessionId);
		this.availableUpgradeChoices.delete(client.sessionId);
		this.inputValidator.removeClient(client.sessionId);
		this.combatEntitySystem.removeOwner(client.sessionId);
		this.combatSystem.removePlayer(client.sessionId);
		this.state.players.delete(client.sessionId);
	}

	onDispose() {}

	private sendUpgradeOptions(client: Client, options: UpgradeDef[]): void {
		client.send(
			ServerMessage.UpgradeOptions,
			options.map(({ id, name, description, iconUrl }) => ({
				id,
				name,
				description,
				iconUrl,
			})),
		);
	}
}
