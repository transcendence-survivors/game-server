import type { MonsterWorldHitbox, Vec3d } from '@transcendence/game-shared';

interface Point3 extends Vec3d {}

const MAX_CACHED_CELLS = 4096;

export class MonsterSpatialIndex {
	private readonly cells = new Map<number, string[]>();
	private readonly activeCells: number[] = [];
	private readonly seenGeneration = new Map<string, number>();
	private queryGeneration = 0;
	private readonly cellSize: number;

	constructor(cellSize = 8) {
		this.cellSize = cellSize;
	}

	rebuild(
		hitboxes: ReadonlyMap<string, readonly MonsterWorldHitbox[]>,
	): void {
		for (const key of this.activeCells) this.cells.get(key)!.length = 0;
		this.activeCells.length = 0;
		if (this.cells.size > MAX_CACHED_CELLS) this.cells.clear();
		this.seenGeneration.clear();
		this.queryGeneration = 0;
		for (const [monsterId, parts] of hitboxes) {
			for (const part of parts)
				this.insert(
					monsterId,
					part.x - part.radius,
					part.x + part.radius,
					part.z - part.radius,
					part.z + part.radius,
				);
		}
	}

	querySwept(
		start: Point3,
		end: Point3,
		radius: number,
		result: string[] = [],
	): string[] {
		return this.queryBounds(
			Math.min(start.x, end.x) - radius,
			Math.max(start.x, end.x) + radius,
			Math.min(start.z, end.z) - radius,
			Math.max(start.z, end.z) + radius,
			result,
		);
	}

	queryRadius(
		x: number,
		z: number,
		radius: number,
		result: string[],
	): string[] {
		return this.queryBounds(
			x - radius,
			x + radius,
			z - radius,
			z + radius,
			result,
		);
	}

	private queryBounds(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		result: string[],
	): string[] {
		result.length = 0;
		const generation = ++this.queryGeneration;
		const firstX = Math.floor(minX / this.cellSize);
		const lastX = Math.floor(maxX / this.cellSize);
		const firstZ = Math.floor(minZ / this.cellSize);
		const lastZ = Math.floor(maxZ / this.cellSize);
		for (let cellZ = firstZ; cellZ <= lastZ; cellZ++)
			for (let cellX = firstX; cellX <= lastX; cellX++) {
				const ids = this.cells.get(this.cellKey(cellX, cellZ));
				if (!ids) continue;
				for (const id of ids) {
					if (this.seenGeneration.get(id) === generation) continue;
					this.seenGeneration.set(id, generation);
					result.push(id);
				}
			}
		return result;
	}

	private insert(
		monsterId: string,
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
	): void {
		const firstX = Math.floor(minX / this.cellSize);
		const lastX = Math.floor(maxX / this.cellSize);
		const firstZ = Math.floor(minZ / this.cellSize);
		const lastZ = Math.floor(maxZ / this.cellSize);
		for (let cellZ = firstZ; cellZ <= lastZ; cellZ++)
			for (let cellX = firstX; cellX <= lastX; cellX++) {
				const key = this.cellKey(cellX, cellZ);
				let ids = this.cells.get(key);
				if (!ids) {
					ids = [];
					this.cells.set(key, ids);
				}
				if (ids.length === 0) this.activeCells.push(key);
				if (ids[ids.length - 1] !== monsterId) ids.push(monsterId);
			}
	}

	private cellKey(x: number, z: number): number {
		const a = x >= 0 ? x * 2 : -x * 2 - 1;
		const b = z >= 0 ? z * 2 : -z * 2 - 1;
		return a >= b ? a * a + a + b : a + b * b;
	}
}
