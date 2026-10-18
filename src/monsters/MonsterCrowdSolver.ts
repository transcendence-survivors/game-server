import {
	MONSTER_DIRECTOR_CONFIG,
	nextPowerOfTwoCapacity,
} from '@transcendence/game-shared';

const {
	totalPopulationCapacity: MAX_MONSTERS,
	separationRadiusMultiplier: RADIUS_SCALE,
	separationPadding: SEPARATION_GAP,
	separationNeighborSkin: NEIGHBOR_MARGIN,
	separationIterations: ITERATIONS,
} = MONSTER_DIRECTOR_CONFIG;
const BUCKET_COUNT = nextPowerOfTwoCapacity(MAX_MONSTERS * 2, 32);
const BUCKET_MASK = BUCKET_COUNT - 1;
const MAX_SEARCH_STAMP = 0x7fff_ffff;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export class MonsterCrowdSolver {
	private readonly positionsX = new Float64Array(MAX_MONSTERS);
	private readonly positionsZ = new Float64Array(MAX_MONSTERS);
	private readonly radii = new Float64Array(MAX_MONSTERS);
	private readonly knockedBack = new Uint8Array(MAX_MONSTERS);
	private readonly regularIndices: number[] = [];
	private readonly bossIndices: number[] = [];
	private count = 0;

	private cellSize = 1;
	private largestRegularRadius = 0;
	private readonly bucketOfRegular = new Int32Array(MAX_MONSTERS);
	private readonly bucketStart = new Int32Array(BUCKET_COUNT + 1);
	private readonly indicesByBucket = new Int32Array(MAX_MONSTERS);

	private readonly nearbyIndices = new Int32Array(MAX_MONSTERS);
	private readonly visitedStamp = new Int32Array(MAX_MONSTERS);
	private searchStamp = 0;

	private readonly pairFirst: number[] = [];
	private readonly pairSecond: number[] = [];
	private overlapNormalX = 0;
	private overlapNormalZ = 0;
	private overlapDepth = 0;
	private solveCount = 0;

	reset(): void {
		this.count = 0;
		this.regularIndices.length = 0;
		this.bossIndices.length = 0;
		this.largestRegularRadius = 0;
	}

	add(
		x: number,
		z: number,
		radius: number,
		isBoss: boolean,
		knockedBack: boolean,
	): void {
		const index = this.count++;
		if (index >= MAX_MONSTERS)
			throw new Error(
				`MonsterCrowdSolver: ${this.count} > ${MAX_MONSTERS}`,
			);
		this.positionsX[index] = x;
		this.positionsZ[index] = z;
		this.radii[index] = Math.max(0, radius);
		this.knockedBack[index] = knockedBack ? 1 : 0;
		if (isBoss) {
			this.bossIndices.push(index);
			return;
		}
		this.regularIndices.push(index);
		this.largestRegularRadius = Math.max(
			this.largestRegularRadius,
			this.radii[index],
		);
	}

	solve(): void {
		this.buildSpatialGrid();
		this.findNeighborPairs();
		for (let iteration = 0; iteration < ITERATIONS; iteration++) {
			this.separateNeighborPairs(iteration);
			for (const monster of this.regularIndices)
				for (const boss of this.bossIndices)
					this.pushAwayFromBoss(monster, boss);
		}
		this.solveCount++;
	}

	positionX(index: number): number {
		return this.positionsX[index];
	}

	positionZ(index: number): number {
		return this.positionsZ[index];
	}

	queryBounds(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		result: number[],
	): number[] {
		result.length = 0;
		const found = this.findMonstersInArea(minX, maxX, minZ, maxZ);
		for (let offset = 0; offset < found; offset++) {
			const index = this.nearbyIndices[offset];
			const x = this.positionsX[index];
			const z = this.positionsZ[index];
			if (x >= minX && x <= maxX && z >= minZ && z <= maxZ)
				result.push(index);
		}
		result.push(...this.bossIndices);
		return result;
	}

	private cellIndex(position: number): number {
		return Math.floor(position / this.cellSize);
	}

	private bucketForCell(cellX: number, cellZ: number): number {
		return (
			(Math.imul(cellX, 92837111) ^ Math.imul(cellZ, 689287499)) &
			BUCKET_MASK
		);
	}

	private buildSpatialGrid(): void {
		this.cellSize =
			2 * this.largestRegularRadius * RADIUS_SCALE +
			SEPARATION_GAP +
			NEIGHBOR_MARGIN;
		const start = this.bucketStart;
		start.fill(0);
		for (let offset = 0; offset < this.regularIndices.length; offset++) {
			const monster = this.regularIndices[offset];
			const bucket = this.bucketForCell(
				this.cellIndex(this.positionsX[monster]),
				this.cellIndex(this.positionsZ[monster]),
			);
			this.bucketOfRegular[offset] = bucket;
			start[bucket]++;
		}
		for (let bucket = 1; bucket <= BUCKET_COUNT; bucket++)
			start[bucket] += start[bucket - 1];
		for (let offset = 0; offset < this.regularIndices.length; offset++)
			this.indicesByBucket[--start[this.bucketOfRegular[offset]]] =
				this.regularIndices[offset];
	}

	private findMonstersInArea(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
	): number {
		const firstCellX = this.cellIndex(minX);
		const firstCellZ = this.cellIndex(minZ);
		const lastCellX = this.cellIndex(maxX);
		const lastCellZ = this.cellIndex(maxZ);
		const cellsInArea =
			(lastCellX - firstCellX + 1) * (lastCellZ - firstCellZ + 1);
		if (cellsInArea > this.regularIndices.length) {
			this.nearbyIndices.set(this.regularIndices);
			return this.regularIndices.length;
		}
		if (++this.searchStamp > MAX_SEARCH_STAMP) {
			this.visitedStamp.fill(0);
			this.searchStamp = 1;
		}
		let found = 0;
		for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ++)
			for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
				const bucket = this.bucketForCell(cellX, cellZ);
				const end = this.bucketStart[bucket + 1];
				for (let slot = this.bucketStart[bucket]; slot < end; slot++) {
					const monster = this.indicesByBucket[slot];
					if (this.visitedStamp[monster] === this.searchStamp)
						continue;
					this.visitedStamp[monster] = this.searchStamp;
					this.nearbyIndices[found++] = monster;
				}
			}
		return found;
	}

	private findNeighborPairs(): void {
		this.pairFirst.length = 0;
		this.pairSecond.length = 0;
		for (const a of this.regularIndices) {
			const x = this.positionsX[a];
			const z = this.positionsZ[a];
			const radius = this.radii[a];
			const reach =
				(radius + this.largestRegularRadius) * RADIUS_SCALE +
				SEPARATION_GAP +
				NEIGHBOR_MARGIN;
			const found = this.findMonstersInArea(
				x - reach,
				x + reach,
				z - reach,
				z + reach,
			);
			for (let offset = 0; offset < found; offset++) {
				const b = this.nearbyIndices[offset];
				if (b <= a) continue;
				const limit =
					(radius + this.radii[b]) * RADIUS_SCALE +
					SEPARATION_GAP +
					NEIGHBOR_MARGIN;
				const dx = x - this.positionsX[b];
				const dz = z - this.positionsZ[b];
				if (dx * dx + dz * dz >= limit * limit) continue;
				if (this.knockedBack[a] && this.knockedBack[b]) continue;
				this.pairFirst.push(a);
				this.pairSecond.push(b);
			}
		}
	}

	private separateNeighborPairs(iteration: number): void {
		const count = this.pairFirst.length;
		const forward = (iteration & 1) === 0;
		for (let step = 0; step < count; step++) {
			const pair = forward ? step : count - 1 - step;
			this.separatePair(this.pairFirst[pair], this.pairSecond[pair]);
		}
	}

	private separatePair(a: number, b: number): void {
		if (!this.measureOverlap(a, b)) return;
		const shareOfA = this.knockedBack[a]
			? 0
			: this.knockedBack[b]
				? 1
				: 0.5;
		this.moveAlongOverlap(a, this.overlapDepth * shareOfA);
		this.moveAlongOverlap(b, -this.overlapDepth * (1 - shareOfA));
	}

	private pushAwayFromBoss(monster: number, boss: number): void {
		if (this.knockedBack[monster] || !this.measureOverlap(monster, boss))
			return;
		this.moveAlongOverlap(monster, this.overlapDepth);
	}

	private moveAlongOverlap(index: number, distance: number): void {
		this.positionsX[index] += this.overlapNormalX * distance;
		this.positionsZ[index] += this.overlapNormalZ * distance;
	}

	private measureOverlap(a: number, b: number): boolean {
		let dx = this.positionsX[a] - this.positionsX[b];
		let dz = this.positionsZ[a] - this.positionsZ[b];
		const minDistance =
			(this.radii[a] + this.radii[b]) * RADIUS_SCALE + SEPARATION_GAP;
		const distanceSquared = dx * dx + dz * dz;
		if (distanceSquared >= minDistance * minDistance) return false;
		const distance = Math.sqrt(distanceSquared);
		let normalLength = distance;
		if (normalLength <= Number.EPSILON) {
			const angle = (a + b + this.solveCount) * GOLDEN_ANGLE;
			dx = Math.cos(angle);
			dz = Math.sin(angle);
			normalLength = 1;
		}
		this.overlapNormalX = dx / normalLength;
		this.overlapNormalZ = dz / normalLength;
		this.overlapDepth = minDistance - distance;
		return true;
	}
}
