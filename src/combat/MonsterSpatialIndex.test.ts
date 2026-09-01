import { describe, expect, test } from 'bun:test';
import type { MonsterWorldHitbox } from '@transcendence/game-shared';
import { MonsterSpatialIndex } from './MonsterSpatialIndex';

const cylinder = (
	x: number,
	z: number,
	radius: number,
): MonsterWorldHitbox => ({
	shape: 'cylinder',
	x,
	y: 1,
	z,
	radius,
	height: 2,
});

describe('MonsterSpatialIndex', () => {
	test('returns only cells crossed by the swept attack', () => {
		const index = new MonsterSpatialIndex(4);
		index.rebuild(
			new Map([
				['near', [cylinder(3, 0, 1)]],
				['far', [cylinder(30, 0, 1)]],
			]),
		);
		expect(
			index.querySwept({ x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, 0.5),
		).toEqual(['near']);
	});

	test('indexes large hitboxes across every covered cell without duplicates', () => {
		const index = new MonsterSpatialIndex(4);
		index.rebuild(new Map([['boss', [cylinder(8, 8, 9)]]]));
		expect(
			index.querySwept({ x: 0, y: 1, z: 0 }, { x: 16, y: 1, z: 16 }, 1),
		).toEqual(['boss']);
	});

	test('fills reusable results in deterministic order', () => {
		const index = new MonsterSpatialIndex(4);
		index.rebuild(
			new Map([
				['b', [cylinder(2, 0, 3)]],
				['a', [cylinder(2, 0, 3)]],
			]),
		);
		const result = ['stale'];
		index.querySwept(
			{ x: 0, y: 1, z: 0 },
			{ x: 4, y: 1, z: 0 },
			0.5,
			result,
		);
		expect(result).toEqual(['b', 'a']);
		index.querySwept(
			{ x: 20, y: 1, z: 0 },
			{ x: 24, y: 1, z: 0 },
			0.5,
			result,
		);
		expect(result).toEqual([]);
	});

	test('reuses cells while radius queries only return current monsters', () => {
		const index = new MonsterSpatialIndex(4);
		const result: string[] = [];
		index.rebuild(
			new Map([
				['near', [cylinder(-2, 1, 0.5)]],
				['outside', [cylinder(20, 20, 0.5)]],
			]),
		);
		index.queryRadius(0, 0, 4, result);
		expect(result).toEqual(['near']);

		index.rebuild(new Map([['replacement', [cylinder(1, -1, 0.5)]]]));
		index.queryRadius(0, 0, 4, result);
		expect(result).toEqual(['replacement']);
	});
});
