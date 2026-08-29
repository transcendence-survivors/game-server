import type { Vec2d, Vec3d } from '@transcendence/game-shared';

export interface MonsterTransform extends Vec3d {
	rotationY: number;
}

export interface MonsterSpatialQuery {
	queryRadius(
		x: number,
		z: number,
		radius: number,
		result: string[],
	): string[];
	querySwept(
		start: Vec2d,
		end: Vec2d,
		radius: number,
		result?: string[],
	): string[];
}

/** Exact server simulation state, independent from Colyseus publication. */
export interface MonsterSimulationSource extends MonsterSpatialQuery {
	readTransform(monsterId: string, output: MonsterTransform): boolean;
}
