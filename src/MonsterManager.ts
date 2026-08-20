import {
	BOSS_KINDS,
	clampPositionToCircle,
	ELITE_MODEL_SCALE,
	GameState,
	MONSTER_DEFINITIONS,
	getMonsterDefinition,
	getMonsterHitbox,
	findSpawnPoint,
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
	isBossKind,
	type BossKind,
	type MonsterDefinition,
	type MonsterRank,
	type Vec3d,
} from '@transcendence/game-shared';
import { DamageResolver } from './combat/DamageResolver';
import { MonsterAiSystem } from './monsters/MonsterAiSystem';
import type { MonsterRuntime } from './monsters/MonsterRuntime';
import type {
	MonsterSimulationSource,
	MonsterTransform,
} from './monsters/MonsterSimulationSource';

interface PendingChildSpawn {
	kind: string;
	x: number;
	z: number;
}

const MONSTER_CATALOG: readonly MonsterDefinition[] =
	Object.values(MONSTER_DEFINITIONS);

/** Returns an exact point on the shared outer chunk-loading ring. */
export function monsterSpawnPointOnRing(
	world: World,
	centerX: number,
	centerZ: number,
	angle: number,
	radius = MONSTER_DIRECTOR_CONFIG.spawnRingRadius,
): Vec3d {
	const point = {
		x: centerX + Math.cos(angle) * radius,
		y: 0,
		z: centerZ + Math.sin(angle) * radius,
	};
	point.y = world.height(point.x, point.z);
	return point;
}

/**
 * Owns monster population, pacing and lifecycle. Individual behavior lives in
 * MonsterAiSystem; all balance values come from the shared catalog/config.
 */
export class MonsterManager implements MonsterSimulationSource {
	private elapsedS = 0;
	private spawnBudget = 0;
	private stressTestEnabled = false;
	private nextMonsterId = 1;
	private nextBossAtS = bossTimeAt(0);
	private lastBossKind?: BossKind;
	private readonly runtimes = new Map<string, MonsterRuntime>();
	private readonly pendingChildSpawns: PendingChildSpawn[] = [];
	private readonly priorityChildSpawns: PendingChildSpawn[] = [];
	private readonly pendingDeadMonsterIds: string[] = [];
	private normalCount = 0;
	private eliteCount = 0;
	private bossCount = 0;
	private readonly spawnCandidates: MonsterDefinition[] = [];
	private nextSpawnUnlockS = 0;
	private readonly ai: MonsterAiSystem;
	private readonly applyKnockbackImpulse = (
		monsterId: string,
		directionX: number,
		directionZ: number,
		projectionDistance: number,
	): void => {
		this.ai.addKnockback(
			monsterId,
			directionX,
			directionZ,
			projectionDistance,
		);
	};
	private readonly handleMonsterDeath = (monsterId: string): void => {
		const runtime = this.runtimes.get(monsterId);
		if (!runtime) return;
		this.setPopulationCounted(runtime, false);
		this.pendingDeadMonsterIds.push(monsterId);
	};

	constructor(
		private readonly world: World,
		private readonly roomState: GameState,
		damage: DamageResolver,
		private readonly random: () => number = Math.random,
	) {
		damage.setKnockbackHandler(this.applyKnockbackImpulse);
		damage.setMonsterDeathHandler(this.handleMonsterDeath);
		this.ai = new MonsterAiSystem(
			world,
			roomState,
			damage,
			this.runtimes,
			(kind, x, z) => {
				if (this.canQueueChildSpawn())
					this.pendingChildSpawns.push({ kind, x, z });
			},
		);
		damage.setMonsterSimulation(this);
		this.roomState.nextBossKind = this.pickNextBossKind();
	}

	update(dtSeconds: number): void {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		this.elapsedS += dtSeconds;
		this.reconcileExternalRemovals();
		this.pruneRuntimes();
		this.flushChildSpawns(this.priorityChildSpawns, true);
		this.updateBossSchedule();
		this.fillPopulation(dtSeconds);

		const removals = this.ai.update(dtSeconds, this.elapsedS);
		for (const id of removals) this.removeMonster(id);
		this.flushChildSpawns(this.pendingChildSpawns, false);
	}

	/** Enables a debug-only saturated population without changing normal pacing. */
	setStressTest(enabled: boolean): void {
		this.stressTestEnabled = enabled;
		this.nextSpawnUnlockS = 0;
		if (!enabled) {
			this.spawnBudget = 0;
			this.trimNormalPopulation();
		}
	}

	private trimNormalPopulation(): void {
		const target = this.clampPopulationTarget(
			this.normalPopulationTarget(this.livingPlayerCount()),
		);
		const excess = this.normalCount - target;
		if (excess <= 0) return;

		const removals: string[] = [];
		this.roomState.monsters.forEach((monster, id) => {
			if (
				removals.length < excess &&
				!monster.isBoss &&
				!monster.life.isDepleted()
			)
				removals.push(id);
		});
		for (const id of removals) this.removeMonster(id);
	}

	private updateBossSchedule(): void {
		while (this.elapsedS >= this.nextBossAtS) {
			if (this.bossCount >= MONSTER_DIRECTOR_CONFIG.bossMaxAlive) {
				this.nextBossAtS += MONSTER_DIRECTOR_CONFIG.bossIntervalS;
				continue;
			}
			if (!this.spawnBoss()) return;
			this.nextBossAtS += MONSTER_DIRECTOR_CONFIG.bossIntervalS;
		}
	}

	private fillPopulation(dtSeconds: number): void {
		const players = this.livingPlayerCount();
		if (
			(!this.stressTestEnabled &&
				this.elapsedS < MONSTER_DIRECTOR_CONFIG.initialSpawnDelayS) ||
			players === 0
		)
			return;

		const stage = difficultyStageAt(this.elapsedS);
		const totalTarget = this.normalPopulationTarget(players);
		const desired = this.clampPopulationTarget(totalTarget);
		let currentCount = this.normalCount;
		let eliteCount = this.eliteCount;
		const maxEliteCount = Math.floor(
			totalTarget * MONSTER_DIRECTOR_CONFIG.maxElitePopulationRatio,
		);

		if (this.stressTestEnabled) this.spawnBudget = Number.POSITIVE_INFINITY;
		else
			this.spawnBudget = Math.min(
				MONSTER_DIRECTOR_CONFIG.spawnBudgetCap,
				this.spawnBudget + stage.spawnRate * dtSeconds,
			);
		if (currentCount >= desired) return;
		this.refreshSpawnCandidates(this.stressTestEnabled);

		const maxSpawns = this.stressTestEnabled
			? MONSTER_DIRECTOR_CONFIG.stressTestMaxSpawnsPerTick
			: MONSTER_DIRECTOR_CONFIG.maxSpawnsPerTick;
		let spawned = 0;
		while (spawned < maxSpawns && currentCount < desired) {
			const definition = this.pickSpawnDefinition(this.stressTestEnabled);
			if (!definition) break;
			const eliteChance =
				eliteCount < maxEliteCount
					? this.stressTestEnabled
						? MONSTER_DIRECTOR_CONFIG.stressTestEliteChance
						: stage.eliteChance
					: 0;
			const rank = this.pickRank(definition, eliteChance);
			if (!this.spawnMonster(definition.kind, rank, players)) break;
			if (!this.stressTestEnabled)
				this.spawnBudget -= definition.spawn.cost;
			currentCount++;
			if (rank === 'elite') eliteCount++;
			spawned++;
		}
	}

	private refreshSpawnCandidates(includeLocked = false): void {
		if (this.elapsedS < this.nextSpawnUnlockS) return;
		this.spawnCandidates.length = 0;
		this.nextSpawnUnlockS = Number.POSITIVE_INFINITY;
		const elapsed = includeLocked ? Number.MAX_SAFE_INTEGER : this.elapsedS;
		for (const definition of MONSTER_CATALOG) {
			if (definition.rank === 'boss') continue;
			if (definition.spawn.minTimeS <= elapsed)
				this.spawnCandidates.push(definition);
			else
				this.nextSpawnUnlockS = Math.min(
					this.nextSpawnUnlockS,
					definition.spawn.minTimeS,
				);
		}
	}

	private pickSpawnDefinition(
		ignoreCost = false,
	): MonsterDefinition | undefined {
		let totalWeight = 0;
		let lastEligible: MonsterDefinition | undefined;
		for (const definition of this.spawnCandidates) {
			if (
				definition.spawn.weight > 0 &&
				(ignoreCost || definition.spawn.cost <= this.spawnBudget)
			) {
				totalWeight += definition.spawn.weight;
				lastEligible = definition;
			}
		}
		if (totalWeight <= 0) return undefined;

		let roll = this.randomValue() * totalWeight;
		for (const definition of this.spawnCandidates) {
			if (
				definition.spawn.weight <= 0 ||
				(!ignoreCost && definition.spawn.cost > this.spawnBudget)
			)
				continue;
			roll -= definition.spawn.weight;
			if (roll <= 0) return definition;
		}
		return lastEligible;
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
		if (this.bossCount >= MONSTER_DIRECTOR_CONFIG.bossMaxAlive)
			return false;
		if (
			this.normalCount + this.bossCount >=
			MONSTER_DIRECTOR_CONFIG.totalPopulationCapacity
		) {
			return false;
		}
		const kind = isBossKind(this.roomState.nextBossKind)
			? this.roomState.nextBossKind
			: this.pickNextBossKind();
		if (!this.spawnMonster(kind, 'boss', this.livingPlayerCount()))
			return false;
		this.lastBossKind = kind;
		this.roomState.nextBossKind = this.pickNextBossKind();
		return true;
	}

	private spawnMonster(
		kind: string,
		rank: MonsterRank,
		playerCount: number,
		x?: number,
		z?: number,
	): boolean {
		if ((x === undefined) !== (z === undefined)) return false;
		const definition = getMonsterDefinition(kind);
		if (!definition) return false;
		if (rank === 'boss' && definition.rank !== 'boss') return false;
		if (rank !== 'boss' && definition.rank === 'boss') return false;

		const hasExplicitPosition = x !== undefined && z !== undefined;
		let spawn: Vec3d;
		if (hasExplicitPosition) {
			spawn = findSpawnPoint(
				this.world,
				x,
				z,
				x,
				z,
				this.world.CELL *
					MONSTER_DIRECTOR_CONFIG.spawnPointSearchRadiusCells,
			);
		} else {
			spawn = monsterSpawnPointOnRing(
				this.world,
				this.roomState.rayX,
				this.roomState.rayZ,
				this.randomValue() * TAU,
			);
		}
		if (hasExplicitPosition)
			clampPositionToCircle(
				spawn,
				this.roomState.rayX,
				this.roomState.rayZ,
				PLAYER_ACCESS_RADIUS + MONSTER_DIRECTOR_CONFIG.boundaryPadding,
			);

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
		monster.isBoss = isBoss;
		monster.isElite = isElite;
		monster.rank = rank;
		monster.sizeMultiplier =
			definition.visualScale * (isElite ? ELITE_MODEL_SCALE : 1);
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

	private flushChildSpawns(
		requests: PendingChildSpawn[],
		ignoreTarget: boolean,
	): void {
		if (requests.length === 0) return;
		const players = this.livingPlayerCount();
		if (players === 0) {
			requests.length = 0;
			return;
		}
		const limit = ignoreTarget
			? MONSTER_DIRECTOR_CONFIG.maxPopulation
			: this.clampPopulationTarget(this.normalPopulationTarget(players));
		let currentCount = this.normalCount;
		for (const request of requests) {
			if (currentCount >= limit) break;
			const { kind, x, z } = request;
			if (this.spawnMonster(kind, 'normal', players, x, z))
				currentCount++;
		}
		requests.length = 0;
	}

	private canQueueChildSpawn(): boolean {
		return (
			this.pendingChildSpawns.length + this.priorityChildSpawns.length <
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

	private pruneRuntimes(): void {
		for (const id of this.pendingDeadMonsterIds) {
			const runtime = this.runtimes.get(id);
			if (!runtime) continue;
			const lastPosition = this.ai.lastPosition(runtime);
			const deathSpawn = runtime.definition.onDeath;
			if (deathSpawn) {
				for (let index = 0; index < deathSpawn.count; index++) {
					if (!this.canQueueChildSpawn()) break;
					const angle = this.randomValue() * TAU;
					this.priorityChildSpawns.push({
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
		this.pendingDeadMonsterIds.length = 0;
	}

	private reconcileExternalRemovals(): void {
		if (this.roomState.monsters.size === this.normalCount + this.bossCount)
			return;
		for (const [id, runtime] of this.runtimes) {
			if (this.roomState.monsters.has(id)) continue;
			this.setPopulationCounted(runtime, false);
			this.pendingDeadMonsterIds.push(id);
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
		else this.normalCount = Math.max(0, this.normalCount + delta);
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

	private normalPopulationTarget(playerCount: number): number {
		return this.stressTestEnabled
			? MONSTER_DIRECTOR_CONFIG.stressTestPopulation
			: targetPopulation(this.elapsedS, playerCount);
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
		start: { x: number; z: number },
		end: { x: number; z: number },
		radius: number,
		result: string[] = [],
	): string[] {
		return this.ai.querySwept(start, end, radius, result);
	}

	private pickNextBossKind(): BossKind {
		const lastBoss = this.lastBossKind;
		const excluded = lastBoss ? BOSS_KINDS.indexOf(lastBoss) : -1;
		const available = BOSS_KINDS.length - (excluded >= 0 ? 1 : 0);
		let index = Math.min(
			available - 1,
			Math.floor(this.randomValue() * available),
		);
		if (excluded >= 0 && index >= excluded) index++;
		return BOSS_KINDS[index] ?? BOSS_KINDS[0];
	}

	private randomValue(): number {
		const value = this.random();
		return Number.isFinite(value)
			? Math.min(0.999999, Math.max(0, value))
			: 0;
	}
}
