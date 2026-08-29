import { describe, expect, test } from 'bun:test';
import {
	BOSS_KINDS,
	BOSS_MODEL_SCALE,
	CHUNK_DISPLAY_RADIUS,
	type BossKind,
	bossTimeAt,
	MONSTER_DIRECTOR_CONFIG,
	Player,
	targetPopulation,
	World,
	getMonsterHitbox,
} from '@transcendence/game-shared';
import { createCombatTestContext } from './testing/CombatTestFixtures';
import { MonsterManager, monsterSpawnPointOnRing } from './MonsterManager';

function setup(random: () => number = () => 0.25) {
	const { state, damage } = createCombatTestContext();
	const world = new World(1);
	const manager = new MonsterManager(world, state, damage, random);
	return { state, world, damage, manager };
}

describe('MonsterManager bosses', () => {
	test('announces and spawns a correctly scaled boss', () => {
		const { state, manager } = setup();
		expect(BOSS_KINDS.includes(state.nextBossKind as BossKind)).toBe(true);
		const announced = state.nextBossKind;
		manager.update(bossTimeAt(0));
		const bosses = [...state.monsters.values()].filter(
			(monster) => monster.isBoss,
		);
		expect(bosses).toHaveLength(1);
		expect(bosses[0].kind).toBe(announced);
		expect(bosses[0].hitboxRadius).toBeCloseTo(
			getMonsterHitbox(announced, false).radius * BOSS_MODEL_SCALE,
		);
		expect(state.nextBossKind).not.toBe(announced);
	});

	test('does not accumulate another boss while one is alive', () => {
		const { state, manager } = setup();
		manager.update(bossTimeAt(1));
		expect(
			[...state.monsters.values()].filter((monster) => monster.isBoss),
		).toHaveLength(1);
	});
});

describe('MonsterManager population', () => {
	test('queues multiplayer knockback as a persistent server impulse', () => {
		const { state, world, damage, manager } = setup();
		const secondPlayer = new Player();
		secondPlayer.x = 10;
		state.players.set('second', secondPlayer);
		manager.update(0.625);
		const entry = [...state.monsters.entries()].find(
			([, monster]) => !monster.isBoss,
		)!;
		const [monsterId, monster] = entry;
		monster.x = 5;
		monster.z = 0;
		monster.y = world.height(monster.x, monster.z);
		monster.knockbackResistance = 0;

		damage.damageMonster(
			{
				playerId: 'second',
				weaponKind: 'bow',
				combatEntityId: 'second:arrow',
			},
			monsterId,
			1,
		);
		expect(monster.x).toBe(5);

		manager.update(1 / 20);

		expect(monster.x).toBeLessThan(4.4);
	});

	test('computes exact points on the outer chunk ring', () => {
		const world = new World(1);
		const point = monsterSpawnPointOnRing(world, 7, -3, Math.PI / 3);

		expect(Math.hypot(point.x - 7, point.z + 3)).toBeCloseTo(
			CHUNK_DISPLAY_RADIUS,
			8,
		);
	});

	test('spawns the wave on the outer chunk ring', () => {
		const { state, manager } = setup();
		state.players.get('player')!.debugImmortal = true;
		// The monster moves immediately during its creation tick, so allow the
		// first inward movement step while checking it remains on the outer ring.
		manager.update(0.625);

		const monster = [...state.monsters.values()].find(
			(candidate) => !candidate.isBoss,
		);
		expect(monster).toBeDefined();
		expect(
			Math.hypot(monster!.x - state.rayX, monster!.z - state.rayZ),
		).toBeGreaterThan(CHUNK_DISPLAY_RADIUS - 10);
		expect(
			Math.hypot(monster!.x - state.rayX, monster!.z - state.rayZ),
		).toBeLessThan(CHUNK_DISPLAY_RADIUS + 10);
	});

	test('builds a dense opening wave from living players', () => {
		const { state, manager } = setup();
		state.players.get('player')!.debugImmortal = true;
		for (let tick = 0; tick < 100; tick++) manager.update(1 / 20);

		const normal = [...state.monsters.values()].filter(
			(monster) => !monster.isBoss,
		);
		expect(normal.length).toBe(targetPopulation(5, 1));
		expect(normal.every((monster) => monster.life.max > 0)).toBe(true);
	});

	test('maintains the configured saturated debug population', () => {
		const { state, manager } = setup(() => 0.01);
		manager.setStressTest(true);

		const stressTicks = Math.ceil(
			MONSTER_DIRECTOR_CONFIG.stressTestPopulation /
				MONSTER_DIRECTOR_CONFIG.stressTestMaxSpawnsPerTick,
		);
		for (let tick = 0; tick < stressTicks; tick++) manager.update(1 / 20);

		expect(
			[...state.monsters.values()].filter((monster) => !monster.isBoss),
		).toHaveLength(MONSTER_DIRECTOR_CONFIG.stressTestPopulation);
		expect(
			[...state.monsters.values()].filter((monster) => monster.isElite),
		).toHaveLength(
			Math.floor(
				MONSTER_DIRECTOR_CONFIG.stressTestPopulation *
					MONSTER_DIRECTOR_CONFIG.maxElitePopulationRatio,
			),
		);

		const removedId = [...state.monsters.entries()].find(
			([, monster]) => !monster.isBoss,
		)?.[0];
		expect(removedId).toBeDefined();
		state.monsters.delete(removedId!);
		manager.update(1 / 20);

		expect(
			[...state.monsters.values()].filter((monster) => !monster.isBoss),
		).toHaveLength(MONSTER_DIRECTOR_CONFIG.stressTestPopulation);

		manager.setStressTest(false);
		expect(
			[...state.monsters.values()].filter((monster) => !monster.isBoss),
		).toHaveLength(targetPopulation(0.45, 1));
	});

	test('does not rescale or heal monsters already spawned', () => {
		const { state, manager } = setup();
		state.players.get('player')!.debugImmortal = true;
		manager.update(1);
		const monster = [...state.monsters.values()][0];
		const current = monster.life.current;
		monster.life.takeDamage(10);
		const damaged = monster.life.current;

		manager.update(120);

		expect(damaged).toBe(current - 10);
		expect(state.monsters.has('monster_1')).toBe(true);
		expect(state.monsters.get('monster_1')!.life.current).toBe(damaged);
	});
});
