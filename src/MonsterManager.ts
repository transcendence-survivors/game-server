import {
	BOSS_KINDS,
	clampPositionToCircle,
	BOSS_MODEL_SCALE,
	ELITE_MODEL_SCALE,
	MONSTER_MODEL_SCALE,
	GameState,
	MONSTER_DEFINITIONS,
	getMonsterDefinition,
	getMonsterHitbox,
	Life,
	MONSTER_DIRECTOR_CONFIG,
	Monster,
	PLAYER_ACCESS_RADIUS,
	targetPopulation,
	TAU,
	World,
	computeArchetypeStats,
	difficultyStageAt,
	bossTimeAt,
	type BossKind,
	type MonsterDefinition,
	type MonsterRank,
	type Vec2d,
	type Vec3d,
} from '@transcendence/game-shared';
import { DamageResolver } from './combat/DamageResolver';
import { MonsterAiSystem } from './monsters/MonsterAiSystem';
import type { MonsterRuntime } from './monsters/MonsterRuntime';
import type {
	MonsterSimulationSource,
	MonsterTransform,
} from './monsters/MonsterSimulationSource';

interface SpawnRequest extends Vec2d {
	kind: string;
}

const MONSTER_CATALOG: readonly MonsterDefinition[] =
	Object.values(MONSTER_DEFINITIONS);

export class MonsterManager implements MonsterSimulationSource {
	private elapsedS = 0;
	private spawnBudget = 0;
	private nextMonsterId = 1;
	private nextBossAtS = bossTimeAt(0);
	private lastBossKind?: BossKind;
	private nextBossKind: BossKind;
	private readonly runtimes = new Map<string, MonsterRuntime>();
	private readonly summonRequests: SpawnRequest[] = [];
	private readonly deathSpawnRequests: SpawnRequest[] = [];
	private readonly deadMonsterIds: string[] = [];
	private regularCount = 0;
	private eliteCount = 0;
	private bossCount = 0;
	private readonly spawnCandidates: MonsterDefinition[] = [];
	private nextSpawnUnlockS = 0;
	private readonly ai: MonsterAiSystem;

	constructor(
		private readonly world: World,
		private readonly roomState: GameState,
		damage: DamageResolver,
		private readonly random: () => number = Math.random,
	) {
		damage.setKnockbackHandler(
			(monsterId, directionX, directionZ, distance) =>
				this.ai.addKnockback(
					monsterId,
					directionX,
					directionZ,
					distance,
				),
		);
		damage.setMonsterDeathHandler((monsterId) => {
			const runtime = this.runtimes.get(monsterId);
			if (!runtime) return;
			this.setPopulationCounted(runtime, false);
			this.deadMonsterIds.push(monsterId);
		});
		this.ai = new MonsterAiSystem(
			world,
			roomState,
			damage,
			this.runtimes,
			(kind, x, z) => {
				if (this.canQueueSpawnRequest())
					this.summonRequests.push({ kind, x, z });
			},
		);
		damage.setMonsterSimulation(this);
		this.nextBossKind = this.pickNextBossKind();
	}

	update(dtSeconds: number): void {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		this.elapsedS += dtSeconds;
		this.detectExternalRemovals();
		this.processDeaths();
		this.spawnRequested(this.deathSpawnRequests, true);
		this.updateBossSchedule();
		this.fillPopulation(dtSeconds);

		const removals = this.ai.update(dtSeconds, this.elapsedS);
		for (const id of removals) this.removeMonster(id);
		this.spawnRequested(this.summonRequests, false);
	}

	private updateBossSchedule(): void {
		while (this.elapsedS >= this.nextBossAtS) {
			if (
				this.bossCount < MONSTER_DIRECTOR_CONFIG.bossMaxAlive &&
				!this.spawnBoss()
			)
				return;
			this.nextBossAtS += MONSTER_DIRECTOR_CONFIG.bossIntervalS;
		}
	}

	private fillPopulation(dtSeconds: number): void {
		const players = this.livingPlayerCount();
		if (
			this.elapsedS < MONSTER_DIRECTOR_CONFIG.initialSpawnDelayS ||
			players === 0
		)
			return;

		const stage = difficultyStageAt(this.elapsedS);
		const totalTarget = targetPopulation(this.elapsedS, players);
		const desired = this.clampPopulationTarget(totalTarget);
		let currentCount = this.regularCount;
		let eliteCount = this.eliteCount;
		const maxEliteCount = Math.floor(
			totalTarget * MONSTER_DIRECTOR_CONFIG.maxElitePopulationRatio,
		);

		this.spawnBudget = Math.min(
			MONSTER_DIRECTOR_CONFIG.spawnBudgetCap,
			this.spawnBudget + stage.spawnRate * dtSeconds,
		);
		if (currentCount >= desired) return;
		this.unlockSpawnCandidates();

		let spawned = 0;
		while (
			spawned < MONSTER_DIRECTOR_CONFIG.maxSpawnsPerTick &&
			currentCount < desired
		) {
			const definition = this.pickSpawnDefinition();
			if (!definition) break;
			const eliteChance =
				eliteCount < maxEliteCount ? stage.eliteChance : 0;
			const rank = this.pickRank(definition, eliteChance);
			if (!this.spawnMonster(definition.kind, rank, players)) break;
			this.spawnBudget -= definition.spawn.cost;
			currentCount++;
			if (rank === 'elite') eliteCount++;
			spawned++;
		}
	}

	private unlockSpawnCandidates(): void {
		if (this.elapsedS < this.nextSpawnUnlockS) return;
		this.spawnCandidates.length = 0;
		this.nextSpawnUnlockS = Number.POSITIVE_INFINITY;
		for (const definition of MONSTER_CATALOG) {
			if (definition.rank === 'boss') continue;
			if (definition.spawn.minTimeS <= this.elapsedS)
				this.spawnCandidates.push(definition);
			else
				this.nextSpawnUnlockS = Math.min(
					this.nextSpawnUnlockS,
					definition.spawn.minTimeS,
				);
		}
	}

	private pickSpawnDefinition(): MonsterDefinition | undefined {
		let totalWeight = 0;
		let lastEligible: MonsterDefinition | undefined;
		for (const definition of this.spawnCandidates) {
			if (!this.canSpawn(definition)) continue;
			totalWeight += definition.spawn.weight;
			lastEligible = definition;
		}
		if (totalWeight <= 0) return undefined;

		let roll = this.randomValue() * totalWeight;
		for (const definition of this.spawnCandidates) {
			if (!this.canSpawn(definition)) continue;
			roll -= definition.spawn.weight;
			if (roll <= 0) return definition;
		}
		return lastEligible;
	}

	private canSpawn({ spawn }: MonsterDefinition): boolean {
		return spawn.weight > 0 && spawn.cost <= this.spawnBudget;
	}

	private pickRank(
		definition: MonsterDefinition,
		eliteChance: number,
	): MonsterRank {
		return definition.spawn.canBeElite &&
			eliteChance > 0 &&
			this.randomValue() < eliteChance
			? 'elite'
			: 'normal';
	}

	private spawnBoss(): boolean {
		if (
			this.regularCount + this.bossCount >=
			MONSTER_DIRECTOR_CONFIG.totalPopulationCapacity
		) {
			return false;
		}
		const kind = this.nextBossKind;
		if (!this.spawnMonster(kind, 'boss', this.livingPlayerCount()))
			return false;
		this.lastBossKind = kind;
		this.nextBossKind = this.pickNextBossKind();
		return true;
	}

	private spawnMonster(
		kind: string,
		rank: MonsterRank,
		playerCount: number,
		at?: Vec2d,
	): boolean {
		const definition = getMonsterDefinition(kind);
		if (!definition || (rank === 'boss') !== (definition.rank === 'boss'))
			return false;

		let spawn: Vec3d;
		if (!at) {
			const angle = this.randomValue() * TAU;
			const radius = MONSTER_DIRECTOR_CONFIG.spawnRingRadius;
			spawn = this.world.groundPoint(
				this.roomState.rayX + Math.cos(angle) * radius,
				this.roomState.rayZ + Math.sin(angle) * radius,
			);
		} else {
			spawn = this.world.groundPoint(at.x, at.z);
			clampPositionToCircle(
				spawn,
				this.roomState.rayX,
				this.roomState.rayZ,
				PLAYER_ACCESS_RADIUS + MONSTER_DIRECTOR_CONFIG.boundaryPadding,
			);
		}

		const stats = computeArchetypeStats(
			kind,
			this.elapsedS,
			rank,
			playerCount,
		);
		const monster = new Monster();
		const isBoss = rank === 'boss';
		const isElite = rank === 'elite';
		monster.kind = kind;
		monster.rank = rank;
		monster.sizeMultiplier =
			definition.visualScale * (isElite ? ELITE_MODEL_SCALE : 1);
		monster.modelScale =
			monster.sizeMultiplier *
			(isBoss ? BOSS_MODEL_SCALE : 1) *
			MONSTER_MODEL_SCALE;
		monster.knockbackResistance = stats.knockbackResistance;
		monster.life = new Life(stats.maxLife);
		monster.damage = stats.damage;
		monster.xpReward = stats.xpReward;
		const hitbox = getMonsterHitbox(kind, isBoss, monster.sizeMultiplier);
		monster.hitboxRadius = hitbox.radius;
		monster.hitboxHeight = hitbox.height;
		monster.hitboxOffsetX = hitbox.offsetX;
		monster.hitboxOffsetY = hitbox.offsetY;
		monster.hitboxOffsetZ = hitbox.offsetZ;
		monster.x = spawn.x;
		monster.y = spawn.y;
		monster.z = spawn.z;
		monster.rotationY = this.randomValue() * TAU;
		monster.animStartedAtS = this.elapsedS;

		const id = `monster_${this.nextMonsterId++}`;
		this.roomState.monsters.set(id, monster);
		const runtime: MonsterRuntime = {
			definition,
			stats,
			rank,
			targetSessionId: '',
			slot: -1,
			activeIndex: -1,
			counted: false,
		};
		this.runtimes.set(id, runtime);
		this.ai.registerMonster(id, monster, runtime);
		this.setPopulationCounted(runtime, true);
		return true;
	}

	private spawnRequested(
		requests: SpawnRequest[],
		ignorePopulationTarget: boolean,
	): void {
		if (requests.length === 0) return;
		const players = this.livingPlayerCount();
		if (players === 0) {
			requests.length = 0;
			return;
		}
		const limit = ignorePopulationTarget
			? MONSTER_DIRECTOR_CONFIG.maxPopulation
			: this.clampPopulationTarget(
					targetPopulation(this.elapsedS, players),
				);
		let currentCount = this.regularCount;
		for (const request of requests) {
			if (currentCount >= limit) break;
			if (this.spawnMonster(request.kind, 'normal', players, request))
				currentCount++;
		}
		requests.length = 0;
	}

	private canQueueSpawnRequest(): boolean {
		return (
			this.summonRequests.length + this.deathSpawnRequests.length <
			MONSTER_DIRECTOR_CONFIG.maxSummonedSpawnsPerTick
		);
	}

	private removeMonster(id: string): void {
		this.roomState.monsters.delete(id);
		const runtime = this.runtimes.get(id);
		if (runtime) {
			this.setPopulationCounted(runtime, false);
			this.ai.unregisterMonster(runtime);
		}
		this.runtimes.delete(id);
	}

	private processDeaths(): void {
		for (const id of this.deadMonsterIds) {
			const runtime = this.runtimes.get(id);
			if (!runtime) continue;
			const lastPosition = this.ai.lastPosition(runtime);
			const deathSpawn = runtime.definition.onDeath;
			if (deathSpawn) {
				for (let index = 0; index < deathSpawn.count; index++) {
					if (!this.canQueueSpawnRequest()) break;
					const angle = this.randomValue() * TAU;
					this.deathSpawnRequests.push({
						kind: deathSpawn.kind,
						x:
							lastPosition.x +
							Math.cos(angle) *
								MONSTER_DIRECTOR_CONFIG.childSpawnRadius,
						z:
							lastPosition.z +
							Math.sin(angle) *
								MONSTER_DIRECTOR_CONFIG.childSpawnRadius,
					});
				}
			}
			this.ai.unregisterMonster(runtime);
			this.runtimes.delete(id);
		}
		this.deadMonsterIds.length = 0;
	}

	private detectExternalRemovals(): void {
		if (this.roomState.monsters.size === this.regularCount + this.bossCount)
			return;
		for (const [id, runtime] of this.runtimes) {
			if (this.roomState.monsters.has(id)) continue;
			this.setPopulationCounted(runtime, false);
			this.deadMonsterIds.push(id);
		}
	}

	private setPopulationCounted(
		runtime: MonsterRuntime,
		counted: boolean,
	): void {
		if (runtime.counted === counted) return;
		runtime.counted = counted;
		const delta = counted ? 1 : -1;
		if (runtime.rank === 'boss')
			this.bossCount = Math.max(0, this.bossCount + delta);
		else this.regularCount = Math.max(0, this.regularCount + delta);
		if (runtime.rank === 'elite')
			this.eliteCount = Math.max(0, this.eliteCount + delta);
	}

	private livingPlayerCount(): number {
		let count = 0;
		this.roomState.players.forEach((player) => {
			if (!player.life.isDepleted()) count++;
		});
		return count;
	}

	private clampPopulationTarget(target: number): number {
		return Math.min(
			MONSTER_DIRECTOR_CONFIG.maxPopulation,
			Math.max(0, target),
		);
	}

	readTransform(monsterId: string, output: MonsterTransform): boolean {
		const runtime = this.runtimes.get(monsterId);
		const monster = this.roomState.monsters.get(monsterId);
		if (!runtime || runtime.slot < 0 || !monster) return false;
		this.ai.readTransform(runtime, output, monster);
		return true;
	}

	queryRadius(
		x: number,
		z: number,
		radius: number,
		result: string[],
	): string[] {
		return this.ai.queryRadius(x, z, radius, result);
	}

	querySwept(
		start: Vec2d,
		end: Vec2d,
		radius: number,
		result: string[] = [],
	): string[] {
		return this.ai.querySwept(start, end, radius, result);
	}

	private pickNextBossKind(): BossKind {
		const options = BOSS_KINDS.filter((kind) => kind !== this.lastBossKind);
		return (
			options[Math.floor(this.randomValue() * options.length)] ??
			BOSS_KINDS[0]
		);
	}

	private randomValue(): number {
		const value = this.random();
		return Number.isFinite(value)
			? Math.min(0.999999, Math.max(0, value))
			: 0;
	}
}
