import {
	MONSTER_DIRECTOR_CONFIG as CONFIG,
	TAU,
} from '@transcendence/game-shared';
import type { ServerMonster } from './ServerMonster';

const GAP = CONFIG.separationPadding;
const NEIGHBOR_GAP = GAP + CONFIG.separationNeighborSkin;
const EMPTY: readonly ServerMonster[] = [];

export class MonsterCrowd {
	private readonly cells = new Map<number, ServerMonster[]>();
	private readonly regulars: ServerMonster[] = [];
	private readonly pairs: ServerMonster[] = [];
	private pairCount = 0;
	private cellSize = 1;

	separate(
		monsters: Iterable<ServerMonster>,
		bosses: Iterable<ServerMonster>,
	) {
		this.regulars.length = 0;
		for (const monster of monsters)
			if (!monster.isBoss) this.regulars.push(monster);
		const largest = Math.max(0, ...this.regulars.map((m) => m.crowdRadius));
		this.cellSize = 2 * largest + NEIGHBOR_GAP;
		this.fillCells();
		this.findPairs(largest);
		for (
			let iteration = 0;
			iteration < CONFIG.separationIterations;
			iteration++
		) {
			for (let index = 0; index < this.pairCount; index += 2)
				push(this.pairs[index]!, this.pairs[index + 1]!);
			for (const boss of bosses)
				for (const monster of this.regulars) push(monster, boss);
		}
	}

	private fillCells(): void {
		for (const [key, cell] of this.cells)
			if (cell.length === 0) this.cells.delete(key);
			else cell.length = 0;
		for (const monster of this.regulars) {
			const key = this.key(
				this.cellOf(monster.x),
				this.cellOf(monster.z),
			);
			const cell = this.cells.get(key);
			if (cell) cell.push(monster);
			else this.cells.set(key, [monster]);
		}
	}

	private findPairs(largest: number): void {
		this.pairCount = 0;
		for (const a of this.regulars) {
			const reach = a.crowdRadius + largest + NEIGHBOR_GAP;
			const lastX = this.cellOf(a.x + reach);
			const lastZ = this.cellOf(a.z + reach);
			for (let cellZ = this.cellOf(a.z - reach); cellZ <= lastZ; cellZ++)
				for (
					let cellX = this.cellOf(a.x - reach);
					cellX <= lastX;
					cellX++
				)
					for (const b of this.cells.get(this.key(cellX, cellZ)) ??
						EMPTY)
						if (a.serial < b.serial && isNear(a, b)) {
							this.pairs[this.pairCount++] = a;
							this.pairs[this.pairCount++] = b;
						}
		}
	}

	private cellOf(position: number): number {
		return Math.floor(position / this.cellSize);
	}

	private key(cellX: number, cellZ: number): number {
		return (cellX + 32768) * 65536 + (cellZ + 32768);
	}
}

function isNear(a: ServerMonster, b: ServerMonster): boolean {
	const reach = a.crowdRadius + b.crowdRadius + NEIGHBOR_GAP;
	return (
		(a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z) < reach * reach
	);
}

function push(a: ServerMonster, b: ServerMonster): void {
	if (a.knockedBack && (b.knockedBack || b.isBoss)) return;
	let dx = a.x - b.x;
	let dz = a.z - b.z;
	const minimum = a.crowdRadius + b.crowdRadius + GAP;
	const distanceSquared = dx * dx + dz * dz;
	if (distanceSquared >= minimum * minimum) return;
	const distance = Math.sqrt(distanceSquared);
	if (distance === 0) {
		const angle = Math.random() * TAU;
		dx = Math.cos(angle);
		dz = Math.sin(angle);
	}
	const overlap = (minimum - distance) / (distance || 1);
	const shareOfA = b.isBoss || b.knockedBack ? 1 : a.knockedBack ? 0 : 0.5;
	a.x += dx * overlap * shareOfA;
	a.z += dz * overlap * shareOfA;
	b.x -= dx * overlap * (1 - shareOfA);
	b.z -= dz * overlap * (1 - shareOfA);
}
