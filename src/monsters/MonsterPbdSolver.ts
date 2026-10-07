import {
	MONSTER_DIRECTOR_CONFIG,
	nextPowerOfTwoCapacity,
	type Monster,
} from '@transcendence/game-shared';

const {
	totalPopulationCapacity: MAX_MONSTERS,
	separationRadiusMultiplier: RADIUS_SCALE,
	separationPadding: PADDING,
	separationNeighborSkin: SKIN,
	separationIterations: ITERATIONS,
} = MONSTER_DIRECTOR_CONFIG;
const BUCKET_COUNT = nextPowerOfTwoCapacity(MAX_MONSTERS * 2, 32);
const BUCKET_MASK = BUCKET_COUNT - 1;
const MAX_SEARCH_ID = 0x7fff_ffff;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export class MonsterPbdSolver {
	private readonly positionsX = new Float64Array(MAX_MONSTERS);
	private readonly positionsZ = new Float64Array(MAX_MONSTERS);
	private readonly radii = new Float64Array(MAX_MONSTERS);
	private readonly knockedBack = new Uint8Array(MAX_MONSTERS);
	private readonly regularMonsters: number[] = [];
	private readonly bosses: number[] = [];

	private cellSize = 1;
	private largestRegularRadius = 0;
	private readonly bucketOfMonster = new Int32Array(MAX_MONSTERS);
	private readonly bucketStart = new Int32Array(BUCKET_COUNT + 1);
	private readonly monstersByBucket = new Int32Array(MAX_MONSTERS);

	private readonly nearbyMonsters = new Int32Array(MAX_MONSTERS);
	private readonly lastSearchId = new Int32Array(MAX_MONSTERS);
	private searchId = 0;

	private readonly pairA: number[] = [];
	private readonly pairB: number[] = [];
	private overlapNormalX = 0;
	private overlapNormalZ = 0;
	private overlapDepth = 0;
	private tick = 0;

	solve(
		monsters: readonly Monster[],
		knockedBack: readonly boolean[],
		desiredX: Float64Array,
		desiredZ: Float64Array,
	): void {
		const count = monsters.length;
		if (count > MAX_MONSTERS)
			throw new Error(`MonsterPbdSolver: ${count} > ${MAX_MONSTERS}`);
		this.loadMonsters(monsters, knockedBack, desiredX, desiredZ);
		this.sortMonstersIntoBuckets();
		this.findNeighborPairs();
		for (let iteration = 0; iteration < ITERATIONS; iteration++) {
			this.separateNeighborPairs(iteration);
			for (const monster of this.regularMonsters)
				for (const boss of this.bosses)
					this.pushAwayFromBoss(monster, boss);
		}
		this.tick++;
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
			const index = this.nearbyMonsters[offset];
			const x = this.positionsX[index];
			const z = this.positionsZ[index];
			if (x >= minX && x <= maxX && z >= minZ && z <= maxZ)
				result.push(index);
		}
		result.push(...this.bosses);
		return result;
	}

	private loadMonsters(
		monsters: readonly Monster[],
		knockedBack: readonly boolean[],
		desiredX: Float64Array,
		desiredZ: Float64Array,
	): void {
		this.regularMonsters.length = 0;
		this.bosses.length = 0;
		this.largestRegularRadius = 0;
		for (let index = 0; index < monsters.length; index++) {
			const monster = monsters[index];
			this.positionsX[index] = desiredX[index];
			this.positionsZ[index] = desiredZ[index];
			this.radii[index] = Math.max(0, monster.hitboxRadius);
			this.knockedBack[index] = knockedBack[index] ? 1 : 0;
			if (monster.isBoss) {
				this.bosses.push(index);
				continue;
			}
			this.regularMonsters.push(index);
			this.largestRegularRadius = Math.max(
				this.largestRegularRadius,
				this.radii[index],
			);
		}
	}

	private cellOf(position: number): number {
		return Math.floor(position / this.cellSize);
	}

	private bucketOfCell(cellX: number, cellZ: number): number {
		return (
			(Math.imul(cellX, 92837111) ^ Math.imul(cellZ, 689287499)) &
			BUCKET_MASK
		);
	}

	private sortMonstersIntoBuckets(): void {
		this.cellSize =
			2 * this.largestRegularRadius * RADIUS_SCALE + PADDING + SKIN;
		const start = this.bucketStart;
		start.fill(0);
		for (let offset = 0; offset < this.regularMonsters.length; offset++) {
			const monster = this.regularMonsters[offset];
			const bucket = this.bucketOfCell(
				this.cellOf(this.positionsX[monster]),
				this.cellOf(this.positionsZ[monster]),
			);
			this.bucketOfMonster[offset] = bucket;
			start[bucket]++;
		}
		for (let bucket = 1; bucket <= BUCKET_COUNT; bucket++)
			start[bucket] += start[bucket - 1];
		for (let offset = 0; offset < this.regularMonsters.length; offset++)
			this.monstersByBucket[--start[this.bucketOfMonster[offset]]] =
				this.regularMonsters[offset];
	}

	private findMonstersInArea(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
	): number {
		const firstCellX = this.cellOf(minX);
		const firstCellZ = this.cellOf(minZ);
		const lastCellX = this.cellOf(maxX);
		const lastCellZ = this.cellOf(maxZ);
		const cellsInArea =
			(lastCellX - firstCellX + 1) * (lastCellZ - firstCellZ + 1);
		if (cellsInArea > this.regularMonsters.length) {
			this.nearbyMonsters.set(this.regularMonsters);
			return this.regularMonsters.length;
		}
		if (++this.searchId > MAX_SEARCH_ID) {
			this.lastSearchId.fill(0);
			this.searchId = 1;
		}
		let found = 0;
		for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ++)
			for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
				const bucket = this.bucketOfCell(cellX, cellZ);
				const end = this.bucketStart[bucket + 1];
				for (let slot = this.bucketStart[bucket]; slot < end; slot++) {
					const monster = this.monstersByBucket[slot];
					if (this.lastSearchId[monster] === this.searchId) continue;
					this.lastSearchId[monster] = this.searchId;
					this.nearbyMonsters[found++] = monster;
				}
			}
		return found;
	}

	private findNeighborPairs(): void {
		this.pairA.length = 0;
		this.pairB.length = 0;
		for (const a of this.regularMonsters) {
			const x = this.positionsX[a];
			const z = this.positionsZ[a];
			const radius = this.radii[a];
			const reach =
				(radius + this.largestRegularRadius) * RADIUS_SCALE +
				PADDING +
				SKIN;
			const found = this.findMonstersInArea(
				x - reach,
				x + reach,
				z - reach,
				z + reach,
			);
			for (let offset = 0; offset < found; offset++) {
				const b = this.nearbyMonsters[offset];
				if (b <= a) continue;
				const limit =
					(radius + this.radii[b]) * RADIUS_SCALE + PADDING + SKIN;
				const dx = x - this.positionsX[b];
				const dz = z - this.positionsZ[b];
				if (dx * dx + dz * dz >= limit * limit) continue;
				if (this.knockedBack[a] && this.knockedBack[b]) continue;
				this.pairA.push(a);
				this.pairB.push(b);
			}
		}
	}

	private separateNeighborPairs(iteration: number): void {
		const count = this.pairA.length;
		const forward = (iteration & 1) === 0;
		for (let step = 0; step < count; step++) {
			const pair = forward ? step : count - 1 - step;
			this.separatePair(this.pairA[pair], this.pairB[pair]);
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
			(this.radii[a] + this.radii[b]) * RADIUS_SCALE + PADDING;
		const distanceSquared = dx * dx + dz * dz;
		if (distanceSquared >= minDistance * minDistance) return false;
		const distance = Math.sqrt(distanceSquared);
		let normalLength = distance;
		if (normalLength <= Number.EPSILON) {
			const angle = (a + b + this.tick) * GOLDEN_ANGLE;
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
