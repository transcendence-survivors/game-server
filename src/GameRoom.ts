import { Client, matchMaker, Room } from 'colyseus';
import {
	World,
	COMBAT_LIMITS,
	GAME_ROOM_TYPE,
	GAME_ROOM_NAME_PROPERTY,
	GameState,
	RAY_DIR_X,
	RAY_DIR_Z,
	RAY_SPEED,
	MoveInput,
	Player,
	PLAYER_ACCESS_RADIUS,
	clampPositionToCircle,
	findSpawnPoint,
	rollUpgradeOptions,
	UPGRADE_CHOICE_COUNT,
	applyUpgrade,
	ClientMessage,
	ServerMessage,
	WeaponState,
	STARTER_WEAPON_KINDS,
	toUpgradeOption,
	normalizeRoomName,
	type SelectUpgradeInput,
	type GameRoomOptions,
	type UpgradeDef,
	PlayerStats,
	TomeId,
} from '@transcendence/game-shared';
import { DownedSystem } from './DownedSystem';
import { InputValidator } from './InputValidator';
import { MonsterManager } from './MonsterManager';
import { DamageResolver } from './combat/DamageResolver';
import { KillRewardSystem } from './combat/KillRewardSystem';
import { CombatEntitySystem } from './combat/CombatEntitySystem';
import { CombatSystem } from './combat/CombatSystem';
import { createWeaponFactory } from './combat/createWeaponFactory';
import { GameStats, tomeKindMap, uploadStats, weaponKindMap } from './upload';
import { StarterWeaponKind } from '../../shared-package/src/utils/Constants';

interface PlayerUpgradeProgress {
	pending?: UpgradeDef[];
	rollSequence: number;
	availableChoices: number;
}

const SIMULATION_INTERVAL_MS = 50;
const RECONNECT_TIMEOUT = 60;

function readEnabledFlag(message: unknown): boolean | undefined {
	if (typeof message !== 'object' || message === null) return undefined;
	const enabled = (message as { enabled?: unknown }).enabled;
	return typeof enabled === 'boolean' ? enabled : undefined;
}

export class GameRoom extends Room<{ state: GameState }> {
	private world!: World;
	private inputValidator!: InputValidator;
	private damageResolver!: DamageResolver;
	private monsterManager!: MonsterManager;
	private combatSystem!: CombatSystem;
	private combatEntitySystem!: CombatEntitySystem;
	private downedSystem!: DownedSystem;
	private readonly upgradeProgress = new Map<string, PlayerUpgradeProgress>();
	private gameOverSent = false;

	async onCreate(options: GameRoomOptions): Promise<void> {
		const roomName = normalizeRoomName(
			typeof options?.roomName === 'string' ? options.roomName : '',
		);
		const alreadyExists = await matchMaker.query({ name: GAME_ROOM_TYPE });
		if (
			alreadyExists.some(
				(room) => room.metadata?.[GAME_ROOM_NAME_PROPERTY] === roomName,
			)
		)
			throw new Error('Room already exists');
		await this.setMetadata({ [GAME_ROOM_NAME_PROPERTY]: roomName });
		this.maxClients = COMBAT_LIMITS.maxPlayers;
		this.state = new GameState();
		this.state.seed = Math.floor(Math.random() * 1e9);
		this.world = new World(this.state.seed);
		this.inputValidator = new InputValidator(this.world, this.state);
		const killRewards = new KillRewardSystem(
			this.state,
			this.clients,
			(playerId, levelsGained) => {
				const progress = this.upgradeProgressFor(playerId);
				progress.availableChoices += levelsGained;
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
			this.monsterManager,
		);
		this.combatSystem = new CombatSystem(
			this.state,
			this.damageResolver,
			createWeaponFactory(),
			this.combatEntitySystem,
		);
		this.downedSystem = new DownedSystem(this.state);
		this.setSimulationInterval(
			this.updateSimulation,
			SIMULATION_INTERVAL_MS,
		);
		this.registerMessageHandlers();
	}

	private createStats(): GameStats {
		const all = [
			...this.state.players.values(),
			...this.state.inactivePlayers.values(),
		];
		return {
			survivalTime: Math.trunc(this.state.combatTimeS),
			players: all.map((p) => ({
				userId: p.userId,
				...this.sanitizeStats(p.stats),
				weapons: Array.from(p.weapons.values()).map((w) => ({
					level: w.level,
					kind: weaponKindMap[w.kind],
				})),
				tomes: Array.from(p.stats.tomeLevels, ([id, level]) => ({
					level,
					kind: tomeKindMap[id as TomeId],
				})),
			})),
		};
	}

	async onDispose() {
		if (!this.state.started) return;
		const data = this.createStats();
		if (data.players.length === 0) return;
		try {
			console.log(data);
			await uploadStats(data);
		} catch (error) {
			console.error(
				`[GameRoom ${this.roomId}] stats upload failed:`,
				error,
			);
		}
		console.log(`[GameRoom ${this.roomId}] disposed`);
	}

	private readonly updateSimulation = (dtMilliseconds: number): void => {
		if (!this.state.started) return;
		if (this.state.players.size <= 0) {
			this.disconnect();
			return;
		}
		const dtSeconds = dtMilliseconds / 1000;
		this.monsterManager.update(dtSeconds);
		this.combatSystem.update(dtSeconds);
		this.combatEntitySystem.update(dtSeconds);
		const damage = this.damageResolver.drainImpactEvents();
		if (damage.length) this.broadcast(ServerMessage.MonsterDamage, damage);
		this.state.rayX += RAY_DIR_X * RAY_SPEED * dtSeconds;
		this.state.rayZ += RAY_DIR_Z * RAY_SPEED * dtSeconds;
		this.state.rayY = this.world.height(this.state.rayX, this.state.rayZ);
		this.downedSystem.update(dtSeconds);
		this.state.players.forEach((player) => {
			const clamped = clampPositionToCircle(
				player,
				this.state.rayX,
				this.state.rayZ,
				PLAYER_ACCESS_RADIUS,
			);
			if (clamped && player.isGrounded)
				player.y = this.world.height(player.x, player.z);
		});
		if (this.gameOverSent || !this.downedSystem.allPlayersDowned()) return;
		this.gameOverSent = true;
		this.broadcast(ServerMessage.GameOver);
		this.disconnect();
	};

	private registerMessageHandlers(): void {
		this.onMessage(
			ClientMessage.Move,
			(client: Client, message: MoveInput) =>
				this.inputValidator.validate(client, message),
		);
		this.onMessage(
			ClientMessage.SetDebugImmortal,
			(client: Client, message: unknown) => {
				const player = this.state.players.get(client.sessionId);
				const enabled = readEnabledFlag(message);
				if (!player || enabled === undefined) return;
				player.debugImmortal = enabled;
			},
		);
		this.onMessage('ready', (client: Client, ready: boolean) => {
			const player = this.state.players.get(client.sessionId);
			if (!player) return;
			player.ready = ready;

			if (this.state.started) return;

			const players = [...this.state.players.values()];
			const allReady =
				players.length > 0 && players.every((p) => p.ready);
			if (allReady) {
				this.state.started = true;
				this.broadcast('gameStart', { seed: this.world.seed });
				this.lock();
			}
		});
		this.onMessage(
			ClientMessage.SetDebugMonsterStress,
			(client: Client, message: unknown) => {
				const enabled = readEnabledFlag(message);
				if (
					!this.state.players.has(client.sessionId) ||
					enabled === undefined
				)
					return;
				this.monsterManager.setStressTest(enabled);
			},
		);
		this.onMessage(
			ClientMessage.Revive,
			(client: Client, message: unknown) => {
				const enabled = readEnabledFlag(message);
				if (!this.state.players.has(client.sessionId)) return;
				if (enabled === undefined) return;
				this.downedSystem.setReviveIntent(client.sessionId, enabled);
			},
		);
		this.onMessage(ClientMessage.RequestUpgradeOptions, (client) =>
			this.handleUpgradeOptionsRequest(client),
		);
		this.onMessage(
			ClientMessage.SelectUpgrade,
			(client, message: SelectUpgradeInput) =>
				this.handleUpgradeSelection(client, message),
		);
	}

	private handleUpgradeOptionsRequest(client: Client): void {
		const player = this.state.players.get(client.sessionId);
		if (!player || player.life.isDepleted()) return;
		const progress = this.upgradeProgressFor(client.sessionId);
		if (progress.availableChoices <= 0) return;
		if (progress.pending) {
			this.sendUpgradeOptions(client, progress.pending);
			return;
		}

		const sequence = ++progress.rollSequence;
		let randomState = this.state.seed ^ sequence;
		for (const character of client.sessionId)
			randomState = Math.imul(
				randomState ^ character.charCodeAt(0),
				16777619,
			);
		const random = () => {
			randomState = (Math.imul(randomState, 1664525) + 1013904223) | 0;
			return (randomState >>> 0) / 4294967296;
		};
		const options = rollUpgradeOptions(
			player,
			UPGRADE_CHOICE_COUNT,
			random,
		);
		if (options.length === 0) {
			progress.availableChoices = 0;
			this.sendUpgradeOptions(client, options);
			return;
		}
		progress.pending = options;
		this.sendUpgradeOptions(client, options);
	}

	private handleUpgradeSelection(
		client: Client,
		message: SelectUpgradeInput,
	): void {
		const player = this.state.players.get(client.sessionId);
		if (
			!player ||
			player.life.isDepleted() ||
			!message ||
			typeof message.id !== 'string' ||
			message.id.length > 64
		)
			return;

		const progress = this.upgradeProgressFor(client.sessionId);
		const upgrade = progress.pending?.find(
			(option) => option.id === message.id,
		);
		if (!upgrade) return;
		if (!applyUpgrade(player, upgrade)) return;
		progress.pending = undefined;
		progress.availableChoices = Math.max(0, progress.availableChoices - 1);
	}

	private pickStarterWeapon(
		rng: () => number = Math.random,
	): StarterWeaponKind {
		return STARTER_WEAPON_KINDS[
			Math.floor(rng() * STARTER_WEAPON_KINDS.length)
		];
	}

	onJoin(client: Client, options: GameRoomOptions): void {
		if (this.state.started) return;
		let alreadyConnected = false;
		this.state.players.forEach((player) => {
			if (player.userId === options.user.userId) alreadyConnected = true;
		});
		if (alreadyConnected) {
			client.leave();
			return;
		}
		const index = this.state.players.size;
		const spread = index === 0 ? 0 : this.world.CELL * 2;
		const angle = index * (Math.PI / 2);
		const spawn = findSpawnPoint(
			this.world,
			this.state.rayX + Math.cos(angle) * spread,
			this.state.rayZ + Math.sin(angle) * spread,
			this.state.rayX,
			this.state.rayZ,
			PLAYER_ACCESS_RADIUS,
		);
		const player = new Player();
		player.id = (index + 1) as 1 | 2 | 3 | 4;
		player.aura.radius = 0;
		player.username = options.user.displayName;
		player.userId = options.user.userId;
		player.avatarUrl = options.user.avatarUrl || '';
		const weapon = new WeaponState();
		weapon.kind = this.pickStarterWeapon();
		player.weapons.set(weapon.kind, weapon);
		player.x = spawn.x;
		player.y = spawn.y;
		player.z = spawn.z;
		this.state.players.set(client.sessionId, player);
		client.send('initSeq', player.lastProcessedSeq);
	}

	private sanitizeStats(s: PlayerStats) {
		const round2 = (n: number) => Math.round(n * 100) / 100;
		return {
			maxHealth: Math.round(s.maxHealth),
			armor: Math.round(s.armor),
			attackDamage: Math.round(s.attackDamage),
			killAmount: Math.round(s.killAmount),
			quantity: Math.round(s.quantity),

			attackSpeed: round2(s.attackSpeed),
			moveSpeed: round2(s.moveSpeed),
			luck: round2(s.luck),
			lifesteal: round2(s.lifesteal),
			range: round2(s.range),
			size: round2(s.size),
			duration: round2(s.duration),
			penetration: round2(s.penetration),
		};
	}

	private deleteAndSavePlayer(client: Client) {
		const player = this.state.players.get(client.sessionId);
		this.state.players.delete(client.sessionId);
		if (player) this.state.inactivePlayers.set(client.sessionId, player);
	}

	async onLeave(client: Client, code?: number) {
		const consented = code == 1000;

		if (consented) {
			this.downedSystem.removePlayer(client.sessionId);
			this.upgradeProgress.delete(client.sessionId);
			this.inputValidator.removeClient(client.sessionId);
			this.combatEntitySystem.removeOwner(client.sessionId);
			this.combatSystem.removePlayer(client.sessionId);
			this.deleteAndSavePlayer(client);
			return;
		}

		if (this.state.players.size === 1 && !this.state.started) {
			this.state.players.delete(client.sessionId);
			this.disconnect();
			return;
		}

		try {
			const newClient = await this.allowReconnection(
				client,
				RECONNECT_TIMEOUT,
			);
			console.log(`${newClient.sessionId} reconnected`);
			const player = this.state.players.get(newClient.sessionId);
			if (player) newClient.send('initSeq', player.lastProcessedSeq);
		} catch (error) {
			console.warn(`${client.sessionId} did not reconnect in time`);
			this.upgradeProgress.delete(client.sessionId);
			this.inputValidator.removeClient(client.sessionId);
			this.combatEntitySystem.removeOwner(client.sessionId);
			this.combatSystem.removePlayer(client.sessionId);
			this.deleteAndSavePlayer(client);
		}
	}

	private sendUpgradeOptions(client: Client, options: UpgradeDef[]): void {
		client.send(ServerMessage.UpgradeOptions, options.map(toUpgradeOption));
	}

	private upgradeProgressFor(playerId: string): PlayerUpgradeProgress {
		let progress = this.upgradeProgress.get(playerId);
		if (!progress) {
			progress = { rollSequence: 0, availableChoices: 0 };
			this.upgradeProgress.set(playerId, progress);
		}
		return progress;
	}
}
