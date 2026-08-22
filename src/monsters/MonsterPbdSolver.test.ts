import { describe, expect, test } from 'bun:test';
import { MONSTER_DIRECTOR_CONFIG, Monster } from '@transcendence/game-shared';
import { MonsterPbdSolver } from './MonsterPbdSolver';

function monster(x: number, z: number, radius = 0.5, isBoss = false): Monster {
	const value = new Monster();
	value.x = x;
	value.z = z;
	value.hitboxRadius = radius;
	value.isBoss = isBoss;
	return value;
}

describe('MonsterPbdSolver', () => {
	test('projects overlapping monsters apart', () => {
		const first = monster(0, 0);
		const second = monster(0.2, 0);
		const before = Math.hypot(first.x - second.x, first.z - second.z);
		const solver = new MonsterPbdSolver();

		solver.solve([first, second]);

		const after = Math.hypot(
			solver.positionX(0) - solver.positionX(1),
			solver.positionZ(0) - solver.positionZ(1),
		);
		expect(after).toBeGreaterThan(before);
		expect(after).toBeGreaterThan(1);
		expect(first.x).toBe(0);
		expect(second.x).toBe(0.2);
	});

	test('never attracts separated monsters or erases a knockback displacement', () => {
		const first = monster(0, 0);
		const knockedBack = monster(3, 0);
		const solver = new MonsterPbdSolver();

		solver.solve([first, knockedBack]);

		expect(solver.positionX(0)).toBe(0);
		expect(solver.positionX(1)).toBe(3);
	});

	test('treats a projected monster as kinematic while clearing its path', () => {
		const projected = monster(0, 0);
		const crowd = monster(0.2, 0);
		const solver = new MonsterPbdSolver();

		solver.solve([projected, crowd], [true, false]);

		expect(solver.positionX(0)).toBe(0);
		expect(solver.positionZ(0)).toBe(0);
		expect(solver.positionX(1)).toBeGreaterThan(0.2);
	});

	test('moves ordinary monsters out of bosses without translating the boss', () => {
		const boss = monster(0, 0, 2, true);
		const ordinary = monster(0, 0, 0.5);
		const solver = new MonsterPbdSolver();

		solver.solve([boss, ordinary]);

		expect(solver.positionX(0)).toBe(0);
		expect(solver.positionZ(0)).toBe(0);
		expect(
			Math.hypot(solver.positionX(1), solver.positionZ(1)),
		).toBeGreaterThan(1);
	});

	test('keeps dense-crowd work strictly bounded', () => {
		const monsters = Array.from(
			{ length: MONSTER_DIRECTOR_CONFIG.stressTestPopulation },
			() => monster(0, 0),
		);
		const solver = new MonsterPbdSolver();
		const stats = solver.solve(monsters);
		const maximumChecks =
			monsters.length *
			MONSTER_DIRECTOR_CONFIG.separationMaxCandidateChecks;
		const maximumConstraints =
			(monsters.length *
				MONSTER_DIRECTOR_CONFIG.separationMaxNeighbors *
				MONSTER_DIRECTOR_CONFIG.separationIterations) /
			2;

		expect(stats.candidateChecks).toBeLessThanOrEqual(maximumChecks);
		expect(stats.cachedPairs).toBeGreaterThan(0);
		expect(stats.cachedPairs).toBeLessThanOrEqual(
			(monsters.length * MONSTER_DIRECTOR_CONFIG.separationMaxNeighbors) /
				2,
		);
		expect(stats.constraints).toBeLessThanOrEqual(maximumConstraints);
		expect(
			monsters.every((_, index) =>
				Number.isFinite(
					solver.positionX(index) + solver.positionZ(index),
				),
			),
		).toBe(true);
	});

	test('produces deterministic server results for the same tick', () => {
		const firstCrowd = Array.from({ length: 64 }, (_, index) =>
			monster((index % 8) * 0.15, Math.floor(index / 8) * 0.15),
		);
		const secondCrowd = firstCrowd.map((value) =>
			monster(value.x, value.z, value.hitboxRadius),
		);
		const firstSolver = new MonsterPbdSolver();
		const secondSolver = new MonsterPbdSolver();

		firstSolver.solve(firstCrowd);
		secondSolver.solve(secondCrowd);

		for (let index = 0; index < firstCrowd.length; index++) {
			expect(firstSolver.positionX(index)).toBe(
				secondSolver.positionX(index),
			);
			expect(firstSolver.positionZ(index)).toBe(
				secondSolver.positionZ(index),
			);
		}
	});

	test('reuses its Verlet list until an authoritative invalidation', () => {
		const monsters = [monster(0, 0), monster(1.6, 0)];
		const solver = new MonsterPbdSolver();

		const first = { ...solver.solve(monsters) };
		const second = { ...solver.solve(monsters) };
		monsters[1].x += MONSTER_DIRECTOR_CONFIG.separationNeighborSkin;
		const displaced = { ...solver.solve(monsters) };
		const kinematic = { ...solver.solve(monsters, [true, false]) };

		expect(first.cacheRebuilt).toBe(true);
		expect(second.cacheRebuilt).toBe(false);
		expect(displaced.cacheRebuilt).toBe(true);
		expect(kinematic.cacheRebuilt).toBe(true);
	});

	test('rebuilds contacts only around agents that crossed the Verlet skin', () => {
		const monsters = [
			monster(0, 0),
			monster(1.7, 0),
			monster(20, 0),
			monster(21.7, 0),
		];
		const positionsX = new Float64Array(monsters.map((value) => value.x));
		const positionsZ = new Float64Array(monsters.length);
		const solver = new MonsterPbdSolver();

		const initial = {
			...solver.solve(monsters, [], positionsX, positionsZ),
		};
		positionsX[0] += MONSTER_DIRECTOR_CONFIG.separationNeighborSkin * 0.6;
		const local = { ...solver.solve(monsters, [], positionsX, positionsZ) };

		expect(local.cacheRebuilt).toBe(true);
		expect(local.dirtyAgents).toBe(1);
		expect(local.cachedPairs).toBeGreaterThanOrEqual(1);
		expect(local.candidateChecks).toBeLessThan(initial.candidateChecks);
	});

	test('sleeps stable contacts and wakes them on authoritative penetration', () => {
		const monsters = [monster(0, 0), monster(1.7, 0)];
		const positionsX = new Float64Array([0, 1.7]);
		const positionsZ = new Float64Array(2);
		const solver = new MonsterPbdSolver();
		let stats = solver.solve(monsters, [], positionsX, positionsZ);

		for (
			let tick = 0;
			tick <= MONSTER_DIRECTOR_CONFIG.separationSleepStableTicks;
			tick++
		)
			stats = solver.solve(monsters, [], positionsX, positionsZ);
		expect(stats.sleepingAgents).toBe(2);

		positionsX[1] = 0.2;
		stats = solver.solve(monsters, [], positionsX, positionsZ);
		expect(stats.sleepingAgents).toBe(0);
		expect(stats.constraints).toBeGreaterThan(0);
	});

	test('moves only changed agents in the shared spatial index', () => {
		const monsters = [monster(0, 0), monster(20, 0)];
		const positionsX = new Float64Array([0, 20]);
		const positionsZ = new Float64Array(2);
		const solver = new MonsterPbdSolver();
		const candidates: number[] = [];

		const initial = {
			...solver.solve(monsters, [], positionsX, positionsZ),
		};
		solver.queryBounds(-1, 1, -1, 1, candidates);
		expect(candidates).toEqual([0]);

		positionsX[0] = 8;
		const moved = { ...solver.solve(monsters, [], positionsX, positionsZ) };
		solver.queryBounds(7, 9, -1, 1, candidates);

		expect(initial.spatialIndexRebuilt).toBe(true);
		expect(moved.spatialIndexRebuilt).toBe(false);
		expect(moved.spatialCellMoves).toBe(1);
		expect(candidates).toEqual([0]);
	});

	test('keeps intrusive cell links valid during mass crossings', () => {
		const count = 256;
		const monsters = Array.from({ length: count }, (_, index) =>
			monster((index % 16) * 0.1, Math.floor(index / 16) * 0.1),
		);
		const positionsX = new Float64Array(monsters.map((value) => value.x));
		const positionsZ = new Float64Array(monsters.map((value) => value.z));
		const solver = new MonsterPbdSolver();
		const candidates: number[] = [];
		solver.solve(monsters, [], positionsX, positionsZ);

		for (let index = 0; index < count; index++) positionsX[index] += 8;
		const moved = solver.solve(monsters, [], positionsX, positionsZ);
		solver.queryBounds(7, 11, -1, 3, candidates);

		expect(moved.spatialCellMoves).toBe(count);
		expect(candidates).toHaveLength(count);
		expect(new Set(candidates).size).toBe(count);
	});
});
