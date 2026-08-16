import type { MonsterWorldHitbox } from '../../../shared-package';

interface Point3 {
	x: number;
	y: number;
	z: number;
}

export class MonsterSpatialIndex {
	private readonly cells = new Map<string, Set<string>>();
	private readonly cellSize: number;

	constructor(cellSize = 8) {
		this.cellSize = cellSize;
	}

	rebuild(hitboxes: ReadonlyMap<string, readonly MonsterWorldHitbox[]>): void {
		this.cells.clear();
		hitboxes.forEach((parts, monsterId) => {
			for (const part of parts)
				this.insert(
					monsterId,
					part.x - part.radius,
					part.x + part.radius,
					part.z - part.radius,
					part.z + part.radius,
				);
		});
	}

	querySwept(start: Point3, end: Point3, radius: number): string[] {
		const ids = new Set<string>();
		this.forCells(
			Math.min(start.x, end.x) - radius,
			Math.max(start.x, end.x) + radius,
			Math.min(start.z, end.z) - radius,
			Math.max(start.z, end.z) + radius,
			(key) => this.cells.get(key)?.forEach((id) => ids.add(id)),
		);
		return [...ids].sort();
	}

	private insert(
		monsterId: string,
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
	): void {
		this.forCells(minX, maxX, minZ, maxZ, (key) => {
			let ids = this.cells.get(key);
			if (!ids) {
				ids = new Set();
				this.cells.set(key, ids);
			}
			ids.add(monsterId);
		});
	}

	private forCells(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		visit: (key: string) => void,
	): void {
		const firstX = Math.floor(minX / this.cellSize);
		const lastX = Math.floor(maxX / this.cellSize);
		const firstZ = Math.floor(minZ / this.cellSize);
		const lastZ = Math.floor(maxZ / this.cellSize);
		for (let z = firstZ; z <= lastZ; z++)
			for (let x = firstX; x <= lastX; x++) visit(`${x},${z}`);
	}
}
