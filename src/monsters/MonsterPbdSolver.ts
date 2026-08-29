import {
	MONSTER_DIRECTOR_CONFIG,
	nextPowerOfTwoCapacity,
	TAU,
	type Monster,
	type Vec2d,
} from '@transcendence/game-shared';

const MIN_CAPACITY = 32;
const UINT32_RANGE = 0x1_0000_0000;

interface SpatialCell extends Vec2d {
	key: number;
	head: number;
	tail: number;
	count: number;
	dirtyCount: number;
	activeIndex: number;
}

function spatialCellKey(cellX: number, cellZ: number): number {
	return (cellX + 0x800000) * 0x1000000 + (cellZ + 0x800000);
}

function positiveModulo(value: number, divisor: number): number {
	const remainder = value % divisor;
	return remainder < 0 ? remainder + divisor : remainder;
}

export interface MonsterPbdStats {
	candidateChecks: number;
	cacheRebuilt: boolean;
	cachedPairs: number;
	constraints: number;
	dirtyAgents: number;
	iterations: number;
	sleepingAgents: number;
	spatialCellMoves: number;
	spatialIndexRebuilt: boolean;
}

/**
 * Bounded iterative PBD solver backed by compact reusable buffers.
 *
 * The broad phase retains clean local contacts and refreshes only dirty cells.
 * Every PBD iteration re-evaluates penetration from current positions without
 * rescanning the grid. No client state participates.
 */
export class MonsterPbdSolver {
	private capacity = 0;
	private solvePhase = 0;
	private positionsX = new Float64Array();
	private positionsZ = new Float64Array();
	private radii = new Float64Array();
	private pairDegrees = new Uint16Array();
	private candidateChecksByAgent = new Uint16Array();
	private dirtyAgent = new Uint8Array();
	private sleeping = new Uint8Array();
	private cachedSleeping = new Uint8Array();
	private sleepTicks = new Uint16Array();
	private kinematic = new Uint8Array();
	private cachedKinematic = new Uint8Array();
	private cachedBoss = new Uint8Array();
	private cachedRadii = new Float64Array();
	private referenceX = new Float64Array();
	private referenceZ = new Float64Array();
	private previousSolvedX = new Float64Array();
	private previousSolvedZ = new Float64Array();
	private readonly cachedMonsters: Monster[] = [];
	private pairCacheAge = 0;
	private agentCellKeys = new Float64Array();
	private agentCellPrevious = new Int32Array();
	private agentCellNext = new Int32Array();
	private readonly gridMonsters: Monster[] = [];
	private gridBoss = new Uint8Array();
	private readonly cellsByKey = new Map<number, SpatialCell>();
	private readonly activeCells: SpatialCell[] = [];
	private readonly freeCells: SpatialCell[] = [];
	private pairFirst = new Uint32Array();
	private pairSecond = new Uint32Array();
	private pairCount = 0;
	private bossIndices = new Uint32Array();
	private bossCount = 0;
	private nonBossMaxRadius = 0;
	private contactNormalX = 0;
	private contactNormalZ = 0;
	private contactPenetration = 0;
	private readonly stats: MonsterPbdStats = {
		candidateChecks: 0,
		cacheRebuilt: false,
		cachedPairs: 0,
		constraints: 0,
		dirtyAgents: 0,
		iterations: 0,
		sleepingAgents: 0,
		spatialCellMoves: 0,
		spatialIndexRebuilt: false,
	};

	solve(
		monsters: readonly Monster[],
		kinematic: readonly boolean[] = [],
		inputX?: Float64Array,
		inputZ?: Float64Array,
	): Readonly<MonsterPbdStats> {
		const count = monsters.length;
		this.ensureAgentCapacity(count);
		this.copyInput(monsters, kinematic, inputX, inputZ);
		this.stats.candidateChecks = 0;
		this.stats.cacheRebuilt = false;
		this.stats.cachedPairs = 0;
		this.stats.constraints = 0;
		this.stats.dirtyAgents = 0;
		this.stats.sleepingAgents = 0;
		this.stats.spatialCellMoves = 0;
		this.stats.spatialIndexRebuilt = false;
		this.stats.iterations =
			count < 2 ? 0 : MONSTER_DIRECTOR_CONFIG.separationIterations;
		this.updateSleeping(monsters, count);
		this.updateGrid(monsters, count);
		if (count < 2) {
			this.invalidatePairCache();
			if (count === 1) {
				this.previousSolvedX[0] = this.positionsX[0];
				this.previousSolvedZ[0] = this.positionsZ[0];
			}
			return this.stats;
		}

		const fullRebuild = this.markDirtyAgents(monsters, count);
		if (this.stats.dirtyAgents > 0) {
			if (fullRebuild) this.pairCount = 0;
			else this.retainCleanPairs(count);
			this.markDirtyCells(count);
			this.buildPairCache(count, !fullRebuild);
			this.snapshotDirtyState(monsters, count, fullRebuild);
			this.stats.cacheRebuilt = true;
		}
		this.stats.cachedPairs = this.pairCount;
		for (
			let iteration = 0;
			iteration < MONSTER_DIRECTOR_CONFIG.separationIterations;
			iteration++
		) {
			this.solveCachedContacts(iteration);
			this.solveBossContacts(monsters, count);
		}
		this.pairCacheAge++;
		for (let index = 0; index < count; index++) {
			this.previousSolvedX[index] = this.positionsX[index];
			this.previousSolvedZ[index] = this.positionsZ[index];
			this.stats.sleepingAgents += this.sleeping[index];
		}
		this.solvePhase++;
		return this.stats;
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
		const cellSize = MONSTER_DIRECTOR_CONFIG.separationCellSize;
		const firstX = Math.floor(minX / cellSize);
		const lastX = Math.floor(maxX / cellSize);
		const firstZ = Math.floor(minZ / cellSize);
		const lastZ = Math.floor(maxZ / cellSize);
		for (let cellZ = firstZ; cellZ <= lastZ; cellZ++)
			for (let cellX = firstX; cellX <= lastX; cellX++) {
				const cell = this.cellsByKey.get(spatialCellKey(cellX, cellZ));
				if (!cell) continue;
				for (
					let index = cell.head;
					index >= 0;
					index = this.agentCellNext[index]
				)
					result.push(index);
			}
		for (let offset = 0; offset < this.bossCount; offset++)
			result.push(this.bossIndices[offset]);
		return result;
	}

	private ensureAgentCapacity(required: number): void {
		if (required <= this.capacity) return;
		this.capacity = nextPowerOfTwoCapacity(required, MIN_CAPACITY);
		this.positionsX = new Float64Array(this.capacity);
		this.positionsZ = new Float64Array(this.capacity);
		this.radii = new Float64Array(this.capacity);
		this.pairDegrees = new Uint16Array(this.capacity);
		this.candidateChecksByAgent = new Uint16Array(this.capacity);
		this.dirtyAgent = new Uint8Array(this.capacity);
		this.sleeping = new Uint8Array(this.capacity);
		this.cachedSleeping = new Uint8Array(this.capacity);
		this.sleepTicks = new Uint16Array(this.capacity);
		this.kinematic = new Uint8Array(this.capacity);
		this.cachedKinematic = new Uint8Array(this.capacity);
		this.cachedBoss = new Uint8Array(this.capacity);
		this.cachedRadii = new Float64Array(this.capacity);
		this.referenceX = new Float64Array(this.capacity);
		this.referenceZ = new Float64Array(this.capacity);
		this.previousSolvedX = new Float64Array(this.capacity);
		this.previousSolvedZ = new Float64Array(this.capacity);
		this.agentCellKeys = new Float64Array(this.capacity);
		this.agentCellKeys.fill(Number.NaN);
		this.agentCellPrevious = new Int32Array(this.capacity);
		this.agentCellPrevious.fill(-1);
		this.agentCellNext = new Int32Array(this.capacity);
		this.agentCellNext.fill(-1);
		this.gridBoss = new Uint8Array(this.capacity);
		this.bossIndices = new Uint32Array(this.capacity);
		const maximumPairs =
			(this.capacity * MONSTER_DIRECTOR_CONFIG.separationMaxNeighbors) /
			2;
		const pairCapacity = nextPowerOfTwoCapacity(maximumPairs, MIN_CAPACITY);
		this.pairFirst = new Uint32Array(pairCapacity);
		this.pairSecond = new Uint32Array(pairCapacity);
	}

	private copyInput(
		monsters: readonly Monster[],
		kinematic: readonly boolean[],
		inputX?: Float64Array,
		inputZ?: Float64Array,
	): void {
		this.bossCount = 0;
		this.nonBossMaxRadius = 0;
		for (let index = 0; index < monsters.length; index++) {
			const monster = monsters[index];
			this.positionsX[index] = inputX?.[index] ?? monster.x;
			this.positionsZ[index] = inputZ?.[index] ?? monster.z;
			this.radii[index] = Math.max(0, monster.hitboxRadius);
			this.kinematic[index] = kinematic[index] ? 1 : 0;
			if (monster.isBoss) this.bossIndices[this.bossCount++] = index;
			else
				this.nonBossMaxRadius = Math.max(
					this.nonBossMaxRadius,
					this.radii[index],
				);
		}
	}

	private updateGrid(monsters: readonly Monster[], count: number): void {
		let structuralChange = this.gridMonsters.length !== count;
		if (!structuralChange)
			for (let index = 0; index < count; index++)
				if (
					this.gridMonsters[index] !== monsters[index] ||
					this.gridBoss[index] !== (monsters[index].isBoss ? 1 : 0)
				) {
					structuralChange = true;
					break;
				}
		if (structuralChange) {
			this.rebuildGrid(monsters, count);
			return;
		}

		const cellSize = MONSTER_DIRECTOR_CONFIG.separationCellSize;
		for (let index = 0; index < count; index++) {
			if (monsters[index].isBoss) continue;
			const cellX = Math.floor(this.positionsX[index] / cellSize);
			const cellZ = Math.floor(this.positionsZ[index] / cellSize);
			const key = spatialCellKey(cellX, cellZ);
			if (this.agentCellKeys[index] === key) continue;
			this.removeAgentFromCell(index);
			this.addAgentToCell(index, cellX, cellZ, key);
			this.stats.spatialCellMoves++;
		}
	}

	private rebuildGrid(monsters: readonly Monster[], count: number): void {
		this.stats.spatialIndexRebuilt = true;
		for (const cell of this.activeCells) this.freeCells.push(cell);
		this.activeCells.length = 0;
		this.cellsByKey.clear();
		this.gridMonsters.length = count;
		this.agentCellKeys.fill(Number.NaN, 0, count);
		this.agentCellPrevious.fill(-1, 0, count);
		this.agentCellNext.fill(-1, 0, count);
		const cellSize = MONSTER_DIRECTOR_CONFIG.separationCellSize;
		for (let index = 0; index < count; index++) {
			const monster = monsters[index];
			this.gridMonsters[index] = monster;
			this.gridBoss[index] = monster.isBoss ? 1 : 0;
			if (monster.isBoss) continue;
			const cellX = Math.floor(this.positionsX[index] / cellSize);
			const cellZ = Math.floor(this.positionsZ[index] / cellSize);
			this.addAgentToCell(
				index,
				cellX,
				cellZ,
				spatialCellKey(cellX, cellZ),
			);
		}
	}

	private addAgentToCell(
		index: number,
		cellX: number,
		cellZ: number,
		key: number,
	): void {
		let cell = this.cellsByKey.get(key);
		if (!cell) {
			cell = this.freeCells.pop() ?? {
				key,
				x: cellX,
				z: cellZ,
				head: -1,
				tail: -1,
				count: 0,
				dirtyCount: 0,
				activeIndex: -1,
			};
			cell.key = key;
			cell.x = cellX;
			cell.z = cellZ;
			cell.head = -1;
			cell.tail = -1;
			cell.count = 0;
			cell.dirtyCount = 0;
			cell.activeIndex = this.activeCells.length;
			this.activeCells.push(cell);
			this.cellsByKey.set(key, cell);
		}
		this.agentCellKeys[index] = key;
		this.agentCellPrevious[index] = cell.tail;
		this.agentCellNext[index] = -1;
		if (cell.tail >= 0) this.agentCellNext[cell.tail] = index;
		else cell.head = index;
		cell.tail = index;
		cell.count++;
	}

	private removeAgentFromCell(index: number): void {
		const key = this.agentCellKeys[index];
		if (Number.isNaN(key)) return;
		const cell = this.cellsByKey.get(key);
		if (!cell) return;
		const previous = this.agentCellPrevious[index];
		const next = this.agentCellNext[index];
		if (previous >= 0) this.agentCellNext[previous] = next;
		else cell.head = next;
		if (next >= 0) this.agentCellPrevious[next] = previous;
		else cell.tail = previous;
		this.agentCellPrevious[index] = -1;
		this.agentCellNext[index] = -1;
		cell.count--;
		this.agentCellKeys[index] = Number.NaN;
		if (cell.count > 0) return;
		this.cellsByKey.delete(key);
		const activeIndex = cell.activeIndex;
		const lastCell = this.activeCells.pop()!;
		if (lastCell !== cell) {
			this.activeCells[activeIndex] = lastCell;
			lastCell.activeIndex = activeIndex;
		}
		cell.activeIndex = -1;
		this.freeCells.push(cell);
	}

	private updateSleeping(monsters: readonly Monster[], count: number): void {
		const epsilon = MONSTER_DIRECTOR_CONFIG.separationSleepMovementEpsilon;
		const epsilonSquared = epsilon * epsilon;
		for (let index = 0; index < count; index++) {
			if (
				this.cachedMonsters[index] !== monsters[index] ||
				this.kinematic[index]
			) {
				this.sleepTicks[index] = 0;
				this.sleeping[index] = 0;
				continue;
			}
			const dx = this.positionsX[index] - this.previousSolvedX[index];
			const dz = this.positionsZ[index] - this.previousSolvedZ[index];
			if (dx * dx + dz * dz > epsilonSquared) {
				this.sleepTicks[index] = 0;
				this.sleeping[index] = 0;
				continue;
			}
			this.sleepTicks[index] = Math.min(
				0xffff,
				this.sleepTicks[index] + 1,
			);
			if (
				this.sleepTicks[index] >=
				MONSTER_DIRECTOR_CONFIG.separationSleepStableTicks
			)
				this.sleeping[index] = 1;
		}
	}

	private markDirtyAgents(
		monsters: readonly Monster[],
		count: number,
	): boolean {
		const fullRebuild =
			this.cachedMonsters.length !== count ||
			this.pairCacheAge >=
				MONSTER_DIRECTOR_CONFIG.separationFullCacheRefreshTicks;
		const maximumDisplacement =
			MONSTER_DIRECTOR_CONFIG.separationNeighborSkin * 0.5;
		const maximumDisplacementSquared =
			maximumDisplacement * maximumDisplacement;
		this.dirtyAgent.fill(fullRebuild ? 1 : 0, 0, count);
		for (let index = 0; index < count; index++) {
			const monster = monsters[index];
			if (
				fullRebuild ||
				this.cachedMonsters[index] !== monster ||
				this.cachedRadii[index] !== this.radii[index] ||
				this.cachedBoss[index] !== (monster.isBoss ? 1 : 0) ||
				this.cachedKinematic[index] !== this.kinematic[index] ||
				this.cachedSleeping[index] !== this.sleeping[index]
			) {
				this.dirtyAgent[index] = 1;
				continue;
			}
			const dx = this.positionsX[index] - this.referenceX[index];
			const dz = this.positionsZ[index] - this.referenceZ[index];
			if (dx * dx + dz * dz >= maximumDisplacementSquared)
				this.dirtyAgent[index] = 1;
		}
		for (let index = 0; index < count; index++)
			this.stats.dirtyAgents += this.dirtyAgent[index];
		return fullRebuild;
	}

	private snapshotDirtyState(
		monsters: readonly Monster[],
		count: number,
		fullRebuild: boolean,
	): void {
		if (fullRebuild) this.cachedMonsters.length = count;
		for (let index = 0; index < count; index++) {
			if (!this.dirtyAgent[index]) continue;
			this.cachedMonsters[index] = monsters[index];
			this.cachedRadii[index] = this.radii[index];
			this.cachedBoss[index] = monsters[index].isBoss ? 1 : 0;
			this.cachedKinematic[index] = this.kinematic[index];
			this.cachedSleeping[index] = this.sleeping[index];
			this.referenceX[index] = this.positionsX[index];
			this.referenceZ[index] = this.positionsZ[index];
		}
		if (fullRebuild) this.pairCacheAge = 0;
	}

	private retainCleanPairs(count: number): void {
		this.pairDegrees.fill(0, 0, count);
		let write = 0;
		for (let pair = 0; pair < this.pairCount; pair++) {
			const first = this.pairFirst[pair];
			const second = this.pairSecond[pair];
			if (this.dirtyAgent[first] || this.dirtyAgent[second]) continue;
			this.pairFirst[write] = first;
			this.pairSecond[write] = second;
			this.pairDegrees[first]++;
			this.pairDegrees[second]++;
			write++;
		}
		this.pairCount = write;
	}

	private markDirtyCells(count: number): void {
		for (const cell of this.activeCells) cell.dirtyCount = 0;
		for (let index = 0; index < count; index++) {
			if (!this.dirtyAgent[index]) continue;
			const cell = this.cellsByKey.get(this.agentCellKeys[index]);
			if (cell) cell.dirtyCount++;
		}
	}

	private invalidatePairCache(): void {
		this.cachedMonsters.length = 0;
		this.pairCount = 0;
		this.pairCacheAge = 0;
		this.sleeping.fill(0);
		this.sleepTicks.fill(0);
	}

	private buildPairCache(count: number, dirtyOnly: boolean): void {
		if (this.activeCells.length === 0) return;
		const cellSize = MONSTER_DIRECTOR_CONFIG.separationCellSize;
		const skin = MONSTER_DIRECTOR_CONFIG.separationNeighborSkin;
		const maximumPairDistance =
			this.nonBossMaxRadius *
				2 *
				MONSTER_DIRECTOR_CONFIG.separationRadiusMultiplier +
			MONSTER_DIRECTOR_CONFIG.separationPadding +
			skin;
		const cellRange = Math.max(
			1,
			Math.ceil(maximumPairDistance / cellSize),
		);
		if (!dirtyOnly) this.pairDegrees.fill(0, 0, count);
		this.candidateChecksByAgent.fill(0, 0, count);
		for (const cell of this.activeCells) {
			if (!dirtyOnly || cell.dirtyCount > 0)
				this.cacheCellPair(cell, cell, dirtyOnly);
			for (let offsetZ = 0; offsetZ <= cellRange; offsetZ++) {
				const minimumX = offsetZ === 0 ? 1 : -cellRange;
				for (let offsetX = minimumX; offsetX <= cellRange; offsetX++) {
					const neighbor = this.cellsByKey.get(
						spatialCellKey(cell.x + offsetX, cell.z + offsetZ),
					);
					if (!neighbor) continue;
					if (
						!dirtyOnly ||
						cell.dirtyCount > 0 ||
						neighbor.dirtyCount > 0
					)
						this.cacheCellPair(cell, neighbor, dirtyOnly);
				}
			}
		}
	}

	private cacheCellPair(
		firstCell: SpatialCell,
		secondCell: SpatialCell,
		dirtyOnly: boolean,
	): void {
		const firstLength = firstCell.count;
		const secondLength = secondCell.count;
		if (secondLength === 0) return;
		const sameCell = firstCell === secondCell;
		const firstRotation = positiveModulo(
			this.solvePhase * 13 + firstCell.x * 7 + firstCell.z * 11,
			firstLength,
		);
		const secondRotation =
			sameCell
				? firstRotation
				: positiveModulo(
						this.solvePhase * 17 +
							secondCell.x * 11 +
							secondCell.z * 7,
						secondLength,
					);
		let first = this.rotatedCellMember(firstCell, firstRotation);
		const rotatedSecond = this.rotatedCellMember(
			secondCell,
			secondRotation,
		);
		for (let firstStep = 0; firstStep < firstLength; firstStep++) {
			let second = sameCell
				? this.nextCellMember(firstCell, first)
				: rotatedSecond;
			const checks = sameCell
				? secondLength - firstStep - 1
				: secondLength;
			for (
				let secondStep = 0;
				secondStep < checks && this.canCheckCandidate(first);
				secondStep++
			) {
				if (
					first !== second &&
					this.canCheckCandidate(second) &&
					(!dirtyOnly ||
						this.dirtyAgent[first] ||
						this.dirtyAgent[second])
				) {
					this.candidateChecksByAgent[first]++;
					this.candidateChecksByAgent[second]++;
					this.stats.candidateChecks++;
					if (!this.kinematic[first] || !this.kinematic[second]) {
						const dx =
							this.positionsX[first] - this.positionsX[second];
						const dz =
							this.positionsZ[first] - this.positionsZ[second];
						const pairDistance =
							(this.radii[first] + this.radii[second]) *
								MONSTER_DIRECTOR_CONFIG.separationRadiusMultiplier +
							MONSTER_DIRECTOR_CONFIG.separationPadding +
							MONSTER_DIRECTOR_CONFIG.separationNeighborSkin;
						if (dx * dx + dz * dz < pairDistance * pairDistance) {
							this.pairFirst[this.pairCount] = first;
							this.pairSecond[this.pairCount] = second;
							this.pairCount++;
							this.pairDegrees[first]++;
							this.pairDegrees[second]++;
						}
					}
				}
				second = this.nextCellMember(secondCell, second);
			}
			first = this.nextCellMember(firstCell, first);
		}
	}

	private rotatedCellMember(cell: SpatialCell, rotation: number): number {
		let member = cell.head;
		for (let step = 0; step < rotation; step++)
			member = this.agentCellNext[member];
		return member;
	}

	private nextCellMember(cell: SpatialCell, member: number): number {
		const next = this.agentCellNext[member];
		return next >= 0 ? next : cell.head;
	}

	private canCheckCandidate(index: number): boolean {
		return (
			this.pairDegrees[index] <
				MONSTER_DIRECTOR_CONFIG.separationMaxNeighbors &&
			this.candidateChecksByAgent[index] <
				MONSTER_DIRECTOR_CONFIG.separationMaxCandidateChecks
		);
	}

	private solveCachedContacts(iteration: number): void {
		if ((iteration & 1) === 0) {
			for (let pair = 0; pair < this.pairCount; pair++) {
				if (
					this.sleeping[this.pairFirst[pair]] &&
					this.sleeping[this.pairSecond[pair]]
				)
					continue;
				this.addSymmetricConstraint(
					this.pairFirst[pair],
					this.pairSecond[pair],
				);
			}
			return;
		}
		for (let pair = this.pairCount - 1; pair >= 0; pair--) {
			if (
				this.sleeping[this.pairFirst[pair]] &&
				this.sleeping[this.pairSecond[pair]]
			)
				continue;
			this.addSymmetricConstraint(
				this.pairFirst[pair],
				this.pairSecond[pair],
			);
		}
	}

	private solveBossContacts(
		monsters: readonly Monster[],
		count: number,
	): void {
		if (this.bossCount === 0) return;
		for (let index = 0; index < count; index++) {
			if (monsters[index].isBoss) continue;
			for (
				let bossOffset = 0;
				bossOffset < this.bossCount;
				bossOffset++
			) {
				this.stats.candidateChecks++;
				this.addBossConstraint(index, this.bossIndices[bossOffset]);
			}
		}
	}

	private addSymmetricConstraint(first: number, second: number): void {
		if (!this.computeContact(first, second)) return;
		const relaxation = MONSTER_DIRECTOR_CONFIG.separationRelaxation;
		if (this.kinematic[first]) {
			this.wake(second);
			const correction = this.contactPenetration * relaxation;
			this.positionsX[second] -= this.contactNormalX * correction;
			this.positionsZ[second] -= this.contactNormalZ * correction;
		} else if (this.kinematic[second]) {
			this.wake(first);
			const correction = this.contactPenetration * relaxation;
			this.positionsX[first] += this.contactNormalX * correction;
			this.positionsZ[first] += this.contactNormalZ * correction;
		} else if (
			this.sleeping[first] &&
			this.contactPenetration <=
				MONSTER_DIRECTOR_CONFIG.separationWakePenetration
		) {
			const correction = this.contactPenetration * relaxation;
			this.positionsX[second] -= this.contactNormalX * correction;
			this.positionsZ[second] -= this.contactNormalZ * correction;
		} else if (
			this.sleeping[second] &&
			this.contactPenetration <=
				MONSTER_DIRECTOR_CONFIG.separationWakePenetration
		) {
			const correction = this.contactPenetration * relaxation;
			this.positionsX[first] += this.contactNormalX * correction;
			this.positionsZ[first] += this.contactNormalZ * correction;
		} else {
			this.wake(first);
			this.wake(second);
			const correction = this.contactPenetration * relaxation * 0.5;
			this.positionsX[first] += this.contactNormalX * correction;
			this.positionsZ[first] += this.contactNormalZ * correction;
			this.positionsX[second] -= this.contactNormalX * correction;
			this.positionsZ[second] -= this.contactNormalZ * correction;
		}
		this.stats.constraints++;
	}

	private addBossConstraint(monster: number, boss: number): void {
		if (this.kinematic[monster] || !this.computeContact(monster, boss))
			return;
		this.wake(monster);
		const correction =
			this.contactPenetration *
			MONSTER_DIRECTOR_CONFIG.separationRelaxation;
		this.positionsX[monster] += this.contactNormalX * correction;
		this.positionsZ[monster] += this.contactNormalZ * correction;
		this.stats.constraints++;
	}

	private wake(index: number): void {
		this.sleeping[index] = 0;
		this.sleepTicks[index] = 0;
	}

	private computeContact(first: number, second: number): boolean {
		let dx = this.positionsX[first] - this.positionsX[second];
		let dz = this.positionsZ[first] - this.positionsZ[second];
		const desiredDistance =
			(this.radii[first] + this.radii[second]) *
				MONSTER_DIRECTOR_CONFIG.separationRadiusMultiplier +
			MONSTER_DIRECTOR_CONFIG.separationPadding;
		const distanceSquared = dx * dx + dz * dz;
		if (distanceSquared >= desiredDistance * desiredDistance) return false;
		const actualDistance = Math.sqrt(distanceSquared);
		let normalDistance = actualDistance;
		if (normalDistance <= Number.EPSILON) {
			const hash =
				((first + 1) * 73856093) ^
				((second + 1) * 19349663) ^
				((this.solvePhase + 1) * 83492791);
			const angle = ((hash >>> 0) / UINT32_RANGE) * TAU;
			dx = Math.cos(angle);
			dz = Math.sin(angle);
			normalDistance = 1;
		}
		this.contactNormalX = dx / normalDistance;
		this.contactNormalZ = dz / normalDistance;
		this.contactPenetration = desiredDistance - actualDistance;
		return true;
	}
}
