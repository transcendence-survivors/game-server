import {
	BOSS_KINDS,
	clampPositionToCircle,
	computeArchetypeStats,
	difficultyStageAt,
	getMonsterDefinition,
	Life,
	Monster,
	MONSTER_DEFINITIONS,
	MONSTER_DIRECTOR_CONFIG as CONFIG,
	monsterBody,
	PLAYER_ACCESS_RADIUS,
	targetPopulation,
	TAU,
	type BossKind,
	type GameState,
	type MonsterRank,
	type Vec2d,
	type World,
} from '@transcendence/game-shared';
import type { DamageResolver } from '../combat/damage/DamageResolver';
import { MonsterAi } from './MonsterAi';
import { MonsterCrowd } from './MonsterCrowd';
import { ServerMonster } from './ServerMonster';

interface SpawnRequest extends Vec2d {
	kind: string;
	ignoresTarget: boolean;
}

const AREA_RADIUS = PLAYER_ACCESS_RADIUS + CONFIG.boundaryPadding;
const SPECIES = Object.values(MONSTER_DEFINITIONS);

export class MonsterDirector {
	private readonly monsters = new Map<string, ServerMonster>();
	private readonly bosses = new Set<ServerMonster>();
	private readonly crowd = new MonsterCrowd();
	private readonly spawnRequests: SpawnRequest[] = [];
	private readonly ai: MonsterAi;
	private elapsedS = 0;
	private spawnBudget = 0;
	private eliteCount = 0;
	private nextId = 1;
	private nextBossAtS: number = CONFIG.bossFirstTimeS;
	private nextBossKind = this.pickBossKind();

	constructor(
		private readonly world: World,
		private readonly roomState: GameState,
		damage: DamageResolver,
	) {
		this.ai = new MonsterAi(roomState, damage, (kind, x, z) =>
			this.requestSpawn({ kind, x, z, ignoresTarget: false }),
		);
		damage.onKnockback = (id, directionX, directionZ, distance) => {
			const monster = this.monsters.get(id);
			if (monster)
				this.ai.addKnockback(monster, directionX, directionZ, distance);
		};
		damage.onMonsterDeath = (id) => {
			const monster = this.monsters.get(id);
			if (monster) this.onDeath(monster);
		};
	}

	update(dtSeconds: number): void {
		this.elapsedS += dtSeconds;
		this.ai.beginTick(dtSeconds, this.elapsedS);
		this.spawnRequested();
		this.spawnBossIfDue();
		this.fillPopulation(dtSeconds);
		for (const monster of this.monsters.values())
			if (this.ai.update(monster)) this.remove(monster);
		this.crowd.separate(this.monsters.values(), this.bosses);
		for (const monster of this.monsters.values()) this.publish(monster);
	}

	queryBox(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		result: string[],
	): string[] {
		const margin = CONFIG.combatSpatialQueryPadding;
		result.length = 0;
		for (const { id, x, z, isBoss } of this.monsters.values())
			if (
				isBoss ||
				(x >= minX - margin &&
					x <= maxX + margin &&
					z >= minZ - margin &&
					z <= maxZ + margin)
			)
				result.push(id);
		return result;
	}

	private spawnBossIfDue(): void {
		if (this.elapsedS < this.nextBossAtS) return;
		if (this.bosses.size < CONFIG.bossMaxAlive) {
			this.spawn(this.nextBossKind, 'boss');
			this.nextBossKind = this.pickBossKind(this.nextBossKind);
		}
		this.nextBossAtS += CONFIG.bossIntervalS;
	}

	private fillPopulation(dtSeconds: number): void {
		const players = this.ai.targets.length;
		if (this.elapsedS < CONFIG.initialSpawnDelayS || players === 0) return;
		const stage = difficultyStageAt(this.elapsedS);
		const target = targetPopulation(this.elapsedS, players);
		const maxElites = Math.floor(target * CONFIG.maxElitePopulationRatio);
		const budget = this.spawnBudget + stage.spawnRate * dtSeconds;
		this.spawnBudget = Math.min(CONFIG.spawnBudgetCap, budget);
		for (let spawned = 0; spawned < CONFIG.maxSpawnsPerTick; spawned++) {
			if (this.regularCount >= Math.min(target, CONFIG.maxPopulation))
				return;
			const definition = this.pickSpecies();
			if (!definition) return;
			const elite =
				definition.spawn.canBeElite &&
				this.eliteCount < maxElites &&
				Math.random() < stage.eliteChance;
			this.spawn(definition.kind, elite ? 'elite' : 'normal');
			this.spawnBudget -= definition.spawn.cost;
		}
	}

	private pickSpecies() {
		const options = SPECIES.filter(
			({ spawn }) =>
				spawn.minTimeS <= this.elapsedS &&
				spawn.weight > 0 &&
				spawn.cost <= this.spawnBudget,
		);
		const total = options.reduce((sum, { spawn }) => sum + spawn.weight, 0);
		let roll = Math.random() * total;
		return options.find(({ spawn }) => (roll -= spawn.weight) < 0);
	}

	private spawn(kind: string, rank: MonsterRank, at?: Vec2d): void {
		const definition = getMonsterDefinition(kind)!;
		const position = at ? { x: at.x, z: at.z } : this.pointOnSpawnRing();
		const { rayX, rayZ } = this.roomState;
		clampPositionToCircle(position, rayX, rayZ, AREA_RADIUS);
		const players = this.ai.targets.length;
		const stats = computeArchetypeStats(kind, this.elapsedS, rank, players);
		const body = monsterBody(kind, rank, definition.visualScale);
		const state = Object.assign(new Monster(), body, {
			kind,
			rank,
			knockbackResistance: stats.knockbackResistance,
			life: new Life(stats.maxLife),
			damage: stats.damage,
			xpReward: stats.xpReward,
			x: position.x,
			y: this.world.height(position.x, position.z),
			z: position.z,
			rotationY: Math.random() * TAU,
			animStartedAtS: this.elapsedS,
		});
		const serial = this.nextId++;
		const id = `monster_${serial}`;
		const monster = new ServerMonster(id, serial, state, definition, stats);
		this.monsters.set(id, monster);
		if (rank === 'boss') this.bosses.add(monster);
		if (rank === 'elite') this.eliteCount++;
		this.roomState.monsters.set(id, state);
	}

	private pointOnSpawnRing(): Vec2d {
		const angle = Math.random() * TAU;
		return {
			x: this.roomState.rayX + Math.cos(angle) * CONFIG.spawnRingRadius,
			z: this.roomState.rayZ + Math.sin(angle) * CONFIG.spawnRingRadius,
		};
	}

	private requestSpawn(request: SpawnRequest): void {
		if (this.spawnRequests.length < CONFIG.maxSummonedSpawnsPerTick)
			this.spawnRequests.push(request);
	}

	private spawnRequested(): void {
		const players = this.ai.targets.length;
		const target = Math.min(
			targetPopulation(this.elapsedS, players),
			CONFIG.maxPopulation,
		);
		for (const request of this.spawnRequests) {
			const limit = request.ignoresTarget ? CONFIG.maxPopulation : target;
			if (players > 0 && this.regularCount < limit)
				this.spawn(request.kind, 'normal', request);
		}
		this.spawnRequests.length = 0;
	}

	private onDeath(monster: ServerMonster): void {
		const children = monster.definition.onDeath;
		for (let index = 0; children && index < children.count; index++) {
			const angle = Math.random() * TAU;
			this.requestSpawn({
				kind: children.kind,
				x: monster.x + Math.cos(angle) * CONFIG.childSpawnRadius,
				z: monster.z + Math.sin(angle) * CONFIG.childSpawnRadius,
				ignoresTarget: true,
			});
		}
		this.remove(monster);
	}

	private remove(monster: ServerMonster): void {
		this.monsters.delete(monster.id);
		this.bosses.delete(monster);
		if (monster.state.rank === 'elite') this.eliteCount--;
		this.roomState.monsters.delete(monster.id);
	}

	private publish(monster: ServerMonster): void {
		const { state } = monster;
		const { rayX, rayZ } = this.roomState;
		clampPositionToCircle(monster, rayX, rayZ, AREA_RADIUS);
		if (monster.x !== state.x || monster.z !== state.z) {
			state.x = monster.x;
			state.z = monster.z;
			state.y = this.world.height(monster.x, monster.z);
		}
		if (monster.rotationY !== state.rotationY)
			state.rotationY = monster.rotationY;
	}

	private get regularCount(): number {
		return this.monsters.size - this.bosses.size;
	}

	private pickBossKind(previous?: BossKind): BossKind {
		const options = BOSS_KINDS.filter((kind) => kind !== previous);
		return options[Math.floor(Math.random() * options.length)]!;
	}
}
