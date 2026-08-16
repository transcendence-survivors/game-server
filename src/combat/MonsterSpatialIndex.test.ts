import { describe, expect, test } from 'bun:test';
import type { MonsterWorldHitbox } from '../../../shared-package';
import { MonsterSpatialIndex } from './MonsterSpatialIndex';

const cylinder = (x: number, z: number, radius: number): MonsterWorldHitbox => ({
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
			index.querySwept(
				{ x: 0, y: 1, z: 0 },
				{ x: 5, y: 1, z: 0 },
				0.5,
			),
		).toEqual(['near']);
	});

	test('indexes large hitboxes across every covered cell without duplicates', () => {
		const index = new MonsterSpatialIndex(4);
		index.rebuild(new Map([['boss', [cylinder(8, 8, 9)]]]));
		expect(
			index.querySwept(
				{ x: 0, y: 1, z: 0 },
				{ x: 16, y: 1, z: 16 },
				1,
			),
		).toEqual(['boss']);
	});
});
