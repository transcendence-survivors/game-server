import {
	World,
	GameState,
	Monster,
	Life,
	Player,
	type MonsterKind,
	type BossKind,
	type StatMultipliers,
	computeMonsterStats,
	splitStatBudget,
	targetPopulation,
	pickDistinct,
	nearestIndex,
	chaseStep,
	MONSTER_KINDS,
	BOSS_KINDS,
	ACTIVE_MONSTER_KIND_COUNT,
	MONSTER_ROTATION_INTERVAL_S,
	MONSTER_BOOST_INTERVAL_S,
	MONSTER_SPAWN_MIN_DIST,
	MONSTER_SPAWN_MAX_DIST,
	MONSTER_MOVE_SPEED,
	MONSTER_ATTACK_RANGE,
	BOSS_ATTACK_RANGE,
	MONSTER_ATTACK_COOLDOWN_S,
} from '../../shared-package';
import { CombatManager } from './CombatManager';

export class MonsterManager {
	private world!: World;
	private roomState!: GameState;
	private combat!: CombatManager;
	private random!: () => number;
	private elapsedS = 0;
	private sinceRotationS = 0;
	private sinceBoostS = 0;
	private nextMonsterId = 1;
	private activeKinds: MonsterKind[] = [];
	private kindMultipliers = new Map<MonsterKind, StatMultipliers>();
	private bossKind!: BossKind;
	private bossMultipliers!: StatMultipliers;

	constructor(
		world: World,
		roomState: GameState,
		combat: CombatManager,
		random: () => number = Math.random,
	) {
		this.world = world;
		this.roomState = roomState;
		this.combat = combat;
		this.random = random;
		this.rotate();
	}

	update(dtSeconds: number) {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		this.elapsedS += dtSeconds;
		this.sinceRotationS += dtSeconds;
		this.sinceBoostS += dtSeconds;
		while (this.sinceRotationS >= MONSTER_ROTATION_INTERVAL_S) {
			this.sinceRotationS -= MONSTER_ROTATION_INTERVAL_S;
			this.rotate();
			this.spawnBoss();
		}
		while (this.sinceBoostS >= MONSTER_BOOST_INTERVAL_S) {
			this.sinceBoostS -= MONSTER_BOOST_INTERVAL_S;
			this.boostAll();
			this.fillPopulation();
		}
		this.stepAll(dtSeconds);
	}

	getActiveKinds(): readonly MonsterKind[] {
		return this.activeKinds;
	}

	getBossKind(): BossKind {
		return this.bossKind;
	}

	private rotate() {
		this.activeKinds = pickDistinct(
			MONSTER_KINDS,
			ACTIVE_MONSTER_KIND_COUNT,
			this.random,
		);
		this.kindMultipliers.clear();
		for (const kind of this.activeKinds) {
			this.kindMultipliers.set(kind, splitStatBudget(this.random()));
		}
		this.bossKind = pickDistinct(BOSS_KINDS, 1, this.random)[0];
		this.bossMultipliers = splitStatBudget(this.random());
		this.roomState.monsters.forEach((monster) => {
			if (monster.isBoss) return;
			const multipliers = this.kindMultipliers.get(
				monster.kind as MonsterKind,
			);
			if (!multipliers) return;
			monster.hpMultiplier = multipliers.hpMultiplier;
			monster.damageMultiplier = multipliers.damageMultiplier;
		});
	}

	private boostAll() {
		this.roomState.monsters.forEach((monster) => {
			const stats = computeMonsterStats(
				this.elapsedS,
				{
					hpMultiplier: monster.hpMultiplier,
					damageMultiplier: monster.damageMultiplier,
				},
				monster.isBoss,
			);
			monster.life.rescale(stats.maxLife);
			monster.damage = stats.damage;
			monster.xpReward = stats.xpReward;
		});
	}

	private fillPopulation() {
		if (this.activeKinds.length === 0) return;
		let alive = 0;
		this.roomState.monsters.forEach((monster) => {
			if (!monster.isBoss) alive++;
		});
		const missing = targetPopulation(this.elapsedS) - alive;
		for (let i = 0; i < missing; i++) {
			const kind =
				this.activeKinds[
					Math.floor(this.random() * this.activeKinds.length)
				];
			this.spawn(kind, false, this.kindMultipliers.get(kind)!);
		}
	}

	private spawnBoss() {
		this.spawn(this.bossKind, true, this.bossMultipliers);
	}

	private stepAll(dtSeconds: number) {
		const sessionIds: string[] = [];
		const targets: Player[] = [];
		this.roomState.players.forEach((player, sessionId) => {
			if (player.life.isDepleted()) return;
			sessionIds.push(sessionId);
			targets.push(player);
		});
		this.roomState.monsters.forEach((monster) => {
			monster.attackCooldownS = Math.max(
				0,
				monster.attackCooldownS - dtSeconds,
			);
			const index = nearestIndex(monster, targets);
			if (index < 0) {
				monster.animState = 'idle';
				return;
			}
			const step = chaseStep(
				monster,
				targets[index],
				MONSTER_MOVE_SPEED,
				dtSeconds,
				monster.isBoss ? BOSS_ATTACK_RANGE : MONSTER_ATTACK_RANGE,
			);
			monster.rotationY = step.rotationY;
			if (step.inRange) {
				monster.animState = 'attack';
				if (monster.attackCooldownS === 0) {
					this.combat.damagePlayer(sessionIds[index], monster.damage);
					monster.attackCooldownS = MONSTER_ATTACK_COOLDOWN_S;
				}
				return;
			}
			monster.x = step.x;
			monster.z = step.z;
			monster.y = this.world.height(monster.x, monster.z);
			monster.animState = 'walk';
		});
	}

	private spawn(kind: string, isBoss: boolean, multipliers: StatMultipliers) {
		const anchor = this.pickAnchorPlayer();
		if (!anchor) return;
		const angle = this.random() * 2 * Math.PI;
		const distance =
			MONSTER_SPAWN_MIN_DIST +
			this.random() * (MONSTER_SPAWN_MAX_DIST - MONSTER_SPAWN_MIN_DIST);
		const stats = computeMonsterStats(this.elapsedS, multipliers, isBoss);
		const monster = new Monster();
		monster.kind = kind;
		monster.isBoss = isBoss;
		monster.hpMultiplier = multipliers.hpMultiplier;
		monster.damageMultiplier = multipliers.damageMultiplier;
		monster.life = new Life(stats.maxLife);
		monster.damage = stats.damage;
		monster.xpReward = stats.xpReward;
		monster.x = anchor.x + Math.cos(angle) * distance;
		monster.z = anchor.z + Math.sin(angle) * distance;
		monster.y = this.world.height(monster.x, monster.z);
		monster.rotationY = this.random() * 2 * Math.PI;
		this.roomState.monsters.set(`monster_${this.nextMonsterId++}`, monster);
	}

	private pickAnchorPlayer(): Player | undefined {
		const players: Player[] = [];
		this.roomState.players.forEach((player) => players.push(player));
		if (players.length === 0) return undefined;
		return players[Math.floor(this.random() * players.length)];
	}
}
