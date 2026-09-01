import {
	chaseStep,
	clampPositionToCircle,
	MONSTER_DIRECTOR_CONFIG,
	nextPowerOfTwoCapacity,
	TAU,
	PLAYER_ACCESS_RADIUS,
	PLAYER_HB_RADIUS,
	resolveTerrainCollision,
	type GameState,
	type Monster,
	type Player,
	type Vec2d,
	World,
} from '@transcendence/game-shared';
import type { DamageResolver } from '../combat/DamageResolver';
import { MonsterHotState } from './MonsterHotState';
import type { MonsterRuntime } from './MonsterRuntime';
import { MonsterPbdSolver } from './MonsterPbdSolver';
import type { MonsterTransform } from './MonsterSimulationSource';

interface Target {
	sessionId: string;
	player: Player;
}

type SpawnChild = (kind: string, x: number, z: number) => void;

/** Server-side movement and behavior system for every living monster. */
export class MonsterAiSystem {
	private readonly targets: Target[] = [];
	private readonly monsterIds: string[] = [];
	private readonly monsters: Monster[] = [];
	private readonly activeRuntimes: MonsterRuntime[] = [];
	private readonly attackSlots = new Map<string, number>();
	private readonly removals: string[] = [];
	private readonly removalSet = new Set<string>();
	private readonly pbdMonsters: Monster[] = [];
	private readonly pbdRuntimes: MonsterRuntime[] = [];
	private readonly pbdMonsterIds: string[] = [];
	private readonly unindexedMonsterIds: string[] = [];
	private readonly spatialCandidateIndices: number[] = [];
	private readonly pbdKinematic: boolean[] = [];
	private pbdPositionsX = new Float64Array(32);
	private pbdPositionsZ = new Float64Array(32);
	private readonly hot = new MonsterHotState();
	private readonly freeHotSlots: number[] = [];
	private nextHotSlot = 0;
	private transformPublishAccumulatorS = 0;
	private publishTransformsThisTick = false;
	private readonly crowdSolver = new MonsterPbdSolver();
	private readonly moveOutput = { x: 0, z: 0 };
	private readonly pbdOrigin = { x: 0, z: 0 };
	private readonly chaseOutput = {
		x: 0,
		z: 0,
		rotationY: 0,
		inRange: false,
	};

	constructor(
		private readonly world: World,
		private readonly roomState: GameState,
		private readonly damage: DamageResolver,
		private readonly runtimes: ReadonlyMap<string, MonsterRuntime>,
		private readonly spawnChild: SpawnChild,
	) {
		this.roomState.monsters.forEach((monster, id) => {
			const runtime = this.runtimes.get(id);
			if (runtime) this.registerMonster(id, monster, runtime);
		});
	}

	registerMonster(
		monsterId: string,
		monster: Monster,
		runtime: MonsterRuntime,
	): void {
		const slot = this.freeHotSlots.pop() ?? this.nextHotSlot++;
		runtime.slot = slot;
		this.hot.initialize(slot, monster, runtime);
		runtime.activeIndex = this.monsters.length;
		this.monsterIds.push(monsterId);
		this.monsters.push(monster);
		this.activeRuntimes.push(runtime);
		this.unindexedMonsterIds.push(monsterId);
	}

	unregisterMonster(runtime: MonsterRuntime): void {
		if (runtime.slot < 0) return;
		const activeIndex = runtime.activeIndex;
		const lastIndex = this.monsters.length - 1;
		if (activeIndex >= 0 && activeIndex <= lastIndex) {
			if (activeIndex !== lastIndex) {
				this.monsterIds[activeIndex] = this.monsterIds[lastIndex];
				this.monsters[activeIndex] = this.monsters[lastIndex];
				const movedRuntime = this.activeRuntimes[lastIndex];
				this.activeRuntimes[activeIndex] = movedRuntime;
				movedRuntime.activeIndex = activeIndex;
			}
			this.monsterIds.pop();
			this.monsters.pop();
			this.activeRuntimes.pop();
		}
		this.freeHotSlots.push(runtime.slot);
		runtime.slot = -1;
		runtime.activeIndex = -1;
	}

	lastPosition(runtime: MonsterRuntime): Vec2d {
		return {
			x: this.hot.lastX[runtime.slot],
			z: this.hot.lastZ[runtime.slot],
		};
	}

	readTransform(
		runtime: MonsterRuntime,
		output: MonsterTransform,
		monster?: Monster,
	): void {
		if (monster) this.syncExternalTransform(monster, runtime);
		const slot = runtime.slot;
		output.x = this.hot.positionX[slot];
		output.y = this.hot.positionY[slot];
		output.z = this.hot.positionZ[slot];
		output.rotationY = this.hot.rotationY[slot];
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

	querySwept(
		start: Vec2d,
		end: Vec2d,
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

	private queryBounds(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		result: string[],
	): string[] {
		const padding = MONSTER_DIRECTOR_CONFIG.combatSpatialQueryPadding;
		this.crowdSolver.queryBounds(
			minX - padding,
			maxX + padding,
			minZ - padding,
			maxZ + padding,
			this.spatialCandidateIndices,
		);
		result.length = 0;
		for (const index of this.spatialCandidateIndices) {
			const id = this.pbdMonsterIds[index];
			if (id && this.roomState.monsters.has(id)) result.push(id);
		}
		for (const id of this.unindexedMonsterIds)
			if (this.roomState.monsters.has(id)) result.push(id);
		return result;
	}

	addKnockback(
		monsterId: string,
		directionX: number,
		directionZ: number,
		projectionDistance: number,
	): void {
		const runtime = this.runtimes.get(monsterId);
		if (!runtime || !Number.isFinite(projectionDistance)) return;
		const duration = MONSTER_DIRECTOR_CONFIG.knockbackDurationS;
		if (duration <= 0 || projectionDistance <= 0) return;
		const slot = runtime.slot;
		const addedSpeed = (projectionDistance * 2) / duration;
		this.hot.knockbackVelocityX[slot] += directionX * addedSpeed;
		this.hot.knockbackVelocityZ[slot] += directionZ * addedSpeed;
		const speed = Math.hypot(
			this.hot.knockbackVelocityX[slot],
			this.hot.knockbackVelocityZ[slot],
		);
		const maximumSpeed = MONSTER_DIRECTOR_CONFIG.knockbackMaximumSpeed;
		if (speed > maximumSpeed) {
			const scale = maximumSpeed / speed;
			this.hot.knockbackVelocityX[slot] *= scale;
			this.hot.knockbackVelocityZ[slot] *= scale;
		}
		this.hot.knockbackRemainingS[slot] = Math.max(
			this.hot.knockbackRemainingS[slot],
			duration,
		);
	}

	update(dtSeconds: number, elapsedS: number): readonly string[] {
		this.transformPublishAccumulatorS += dtSeconds;
		const publishInterval =
			MONSTER_DIRECTOR_CONFIG.monsterTransformPublishIntervalS;
		this.publishTransformsThisTick =
			this.transformPublishAccumulatorS + 1e-9 >= publishInterval;
		if (this.publishTransformsThisTick) {
			this.transformPublishAccumulatorS =
				this.transformPublishAccumulatorS < publishInterval
					? 0
					: this.transformPublishAccumulatorS % publishInterval;
		}
		let targetCount = 0;
		this.attackSlots.clear();
		this.removals.length = 0;
		this.removalSet.clear();
		this.roomState.players.forEach((player, sessionId) => {
			if (player.life.isDepleted()) return;
			const target = this.targets[targetCount++];
			if (target) {
				target.sessionId = sessionId;
				target.player = player;
			} else this.targets.push({ sessionId, player });
		});
		this.targets.length = targetCount;
		for (let index = 0; index < this.monsters.length; index++) {
			const id = this.monsterIds[index];
			const monster = this.monsters[index];
			if (this.removalSet.has(id)) continue;
			const runtime = this.activeRuntimes[index];
			if (monster.life.isDepleted()) continue;
			const slot = runtime.slot;
			this.hot.knockbackProtected[slot] = 0;
			this.syncExternalTransform(monster, runtime);
			this.hot.lastX[slot] = this.hot.positionX[slot];
			this.hot.lastZ[slot] = this.hot.positionZ[slot];
			this.hot.attackCooldownS[slot] = Math.max(
				0,
				this.hot.attackCooldownS[slot] - dtSeconds,
			);
			this.hot.specialCooldownS[slot] = Math.max(
				0,
				this.hot.specialCooldownS[slot] - dtSeconds,
			);
			this.hot.chargeCooldownS[slot] = Math.max(
				0,
				this.hot.chargeCooldownS[slot] - dtSeconds,
			);
			this.hot.chargeRemainingS[slot] = Math.max(
				0,
				this.hot.chargeRemainingS[slot] - dtSeconds,
			);
			if (this.applyKnockbackImpulse(monster, runtime, dtSeconds)) {
				this.setAnimation(monster, 'idle', elapsedS);
				continue;
			}

			const target = this.selectTarget(runtime);
			if (!target) {
				this.setAnimation(monster, 'idle', elapsedS);
				continue;
			}
			runtime.targetSessionId = target.sessionId;
			const distance = this.distance(runtime, target.player);
			const handled = this.updateBehavior(
				id,
				monster,
				runtime,
				target,
				distance,
				dtSeconds,
				elapsedS,
			);
			if (!handled) this.setAnimation(monster, 'idle', elapsedS);
		}
		this.solveCrowdContacts();
		return this.removals;
	}

	private solveCrowdContacts(): void {
		this.pbdMonsters.length = 0;
		this.pbdRuntimes.length = 0;
		this.pbdMonsterIds.length = 0;
		this.pbdKinematic.length = 0;
		this.ensurePbdPositionCapacity(this.monsters.length);
		for (let index = 0; index < this.monsters.length; index++) {
			const id = this.monsterIds[index];
			const monster = this.monsters[index];
			const runtime = this.activeRuntimes[index];
			if (
				!this.removalSet.has(id) &&
				!monster.life.isDepleted() &&
				runtime.slot >= 0
			) {
				this.pbdMonsters.push(monster);
				this.pbdRuntimes.push(runtime);
				this.pbdMonsterIds.push(id);
				this.pbdKinematic.push(
					this.hot.knockbackProtected[runtime.slot] !== 0,
				);
				const pbdIndex = this.pbdMonsters.length - 1;
				this.pbdPositionsX[pbdIndex] = this.hot.positionX[runtime.slot];
				this.pbdPositionsZ[pbdIndex] = this.hot.positionZ[runtime.slot];
			}
		}
		this.crowdSolver.solve(
			this.pbdMonsters,
			this.pbdKinematic,
			this.pbdPositionsX,
			this.pbdPositionsZ,
		);
		this.unindexedMonsterIds.length = 0;
		for (let index = 0; index < this.pbdMonsters.length; index++) {
			const monster = this.pbdMonsters[index];
			const runtime = this.pbdRuntimes[index];
			const slot = runtime.slot;
			const desiredX = this.crowdSolver.positionX(index);
			const desiredZ = this.crowdSolver.positionZ(index);
			let finalX = desiredX;
			let finalZ = desiredZ;
			if (
				desiredX !== this.hot.positionX[slot] ||
				desiredZ !== this.hot.positionZ[slot]
			) {
				this.pbdOrigin.x = this.hot.positionX[slot];
				this.pbdOrigin.z = this.hot.positionZ[slot];
				const resolved = this.resolveTerrainMove(
					desiredX,
					desiredZ,
					this.hot.positionY[slot],
					Math.max(PLAYER_HB_RADIUS, monster.hitboxRadius),
				);
				clampPositionToCircle(
					resolved,
					this.roomState.rayX,
					this.roomState.rayZ,
					PLAYER_ACCESS_RADIUS +
						MONSTER_DIRECTOR_CONFIG.boundaryPadding,
				);
				finalX = resolved.x;
				finalZ = resolved.z;
			}
			if (
				finalX !== this.hot.positionX[slot] ||
				finalZ !== this.hot.positionZ[slot]
			)
				this.hot.groundDirty[slot] = 1;
			this.hot.positionX[slot] = finalX;
			this.hot.positionZ[slot] = finalZ;
			if (this.hot.groundDirty[slot]) {
				this.hot.positionY[slot] = this.world.height(finalX, finalZ);
				this.hot.groundDirty[slot] = 0;
			}
			this.hot.lastX[slot] = finalX;
			this.hot.lastZ[slot] = finalZ;
			if (
				this.publishTransformsThisTick ||
				this.hot.knockbackProtected[slot] !== 0
			)
				this.publishPosition(monster, runtime, finalX, finalZ);
		}
	}

	private ensurePbdPositionCapacity(required: number): void {
		if (required <= this.pbdPositionsX.length) return;
		const capacity = nextPowerOfTwoCapacity(
			required,
			this.pbdPositionsX.length,
		);
		this.pbdPositionsX = new Float64Array(capacity);
		this.pbdPositionsZ = new Float64Array(capacity);
	}

	private applyKnockbackImpulse(
		monster: Monster,
		runtime: MonsterRuntime,
		dtSeconds: number,
	): boolean {
		const slot = runtime.slot;
		const remaining = this.hot.knockbackRemainingS[slot];
		if (remaining <= 0) return false;
		const step = Math.min(dtSeconds, remaining);
		const integrationScale = step * (1 - (step * 0.5) / remaining);
		const desiredX =
			this.hot.positionX[slot] +
			this.hot.knockbackVelocityX[slot] * integrationScale;
		const desiredZ =
			this.hot.positionZ[slot] +
			this.hot.knockbackVelocityZ[slot] * integrationScale;
		const originX = this.hot.positionX[slot];
		const originZ = this.hot.positionZ[slot];
		this.applyDesiredPosition(monster, runtime, desiredX, desiredZ);
		const remainingAfter = Math.max(0, remaining - step);
		const velocityScale = remainingAfter / remaining;
		this.hot.knockbackVelocityX[slot] *= velocityScale;
		this.hot.knockbackVelocityZ[slot] *= velocityScale;
		this.hot.knockbackRemainingS[slot] = remainingAfter;
		this.hot.knockbackProtected[slot] = 1;
		if (remainingAfter <= Number.EPSILON) {
			this.hot.knockbackVelocityX[slot] = 0;
			this.hot.knockbackVelocityZ[slot] = 0;
		} else {
			const desiredDx = desiredX - originX;
			const desiredDz = desiredZ - originZ;
			const actualDx = this.hot.positionX[slot] - originX;
			const actualDz = this.hot.positionZ[slot] - originZ;
			const desiredDistanceSquared =
				desiredDx * desiredDx + desiredDz * desiredDz;
			const actualDistanceSquared =
				actualDx * actualDx + actualDz * actualDz;
			if (
				desiredDistanceSquared <= Number.EPSILON ||
				actualDistanceSquared < desiredDistanceSquared * 0.04
			) {
				this.hot.knockbackVelocityX[slot] = 0;
				this.hot.knockbackVelocityZ[slot] = 0;
				this.hot.knockbackRemainingS[slot] = 0;
			} else {
				const actualDistance = Math.sqrt(actualDistanceSquared);
				const speed = Math.hypot(
					this.hot.knockbackVelocityX[slot],
					this.hot.knockbackVelocityZ[slot],
				);
				this.hot.knockbackVelocityX[slot] =
					(actualDx / actualDistance) * speed;
				this.hot.knockbackVelocityZ[slot] =
					(actualDz / actualDistance) * speed;
			}
		}
		return true;
	}

	private updateBehavior(
		id: string,
		monster: Monster,
		runtime: MonsterRuntime,
		target: Target,
		distance: number,
		dtSeconds: number,
		elapsedS: number,
	): boolean {
		const ai = runtime.definition.ai;
		if (ai.kind === 'bomber')
			return this.updateBomber(
				id,
				monster,
				runtime,
				target,
				distance,
				dtSeconds,
				elapsedS,
			);
		if (ai.kind === 'charger')
			return this.updateCharger(
				monster,
				runtime,
				target,
				distance,
				dtSeconds,
				elapsedS,
			);
		if (ai.kind === 'ranged')
			return this.updateRanged(
				monster,
				runtime,
				target,
				distance,
				dtSeconds,
				elapsedS,
			);
		if (ai.kind === 'summoner') {
			this.updateSummon(runtime, monster, elapsedS);
			return this.updatePreferredDistance(
				monster,
				runtime,
				target,
				distance,
				dtSeconds,
				elapsedS,
			);
		}
		if (ai.kind === 'boss')
			return this.updateBoss(
				monster,
				runtime,
				target,
				distance,
				dtSeconds,
				elapsedS,
			);

		return this.updateContact(
			monster,
			runtime,
			target,
			distance,
			dtSeconds,
			elapsedS,
		);
	}

	private updateContact(
		monster: Monster,
		runtime: MonsterRuntime,
		target: Target,
		distance: number,
		dtSeconds: number,
		elapsedS: number,
	): boolean {
		const ai = runtime.definition.ai;
		const stopDistance =
			runtime.stats.attackRange + monster.hitboxRadius + PLAYER_HB_RADIUS;
		if (distance <= stopDistance) {
			if (!this.claimAttackSlot(target.sessionId, monster.isBoss)) {
				this.move(monster, runtime, target.player, 0, dtSeconds);
				this.setAnimation(monster, 'walk', elapsedS);
				return true;
			}
			this.setAnimation(monster, 'attack', elapsedS);
			if (this.hot.attackCooldownS[runtime.slot] <= 0) {
				this.hitPlayer(
					runtime,
					target.sessionId,
					ai.contactDamageMultiplier,
				);
				this.hot.attackCooldownS[runtime.slot] =
					runtime.stats.attackCooldownS;
			}
			return true;
		}
		this.move(
			monster,
			runtime,
			target.player,
			runtime.stats.moveSpeed * ai.movementSpeedMultiplier,
			dtSeconds,
			stopDistance,
		);
		this.setAnimation(monster, 'walk', elapsedS);
		return true;
	}

	private updateRanged(
		monster: Monster,
		runtime: MonsterRuntime,
		target: Target,
		distance: number,
		dtSeconds: number,
		elapsedS: number,
	): boolean {
		const preferred = Math.max(
			runtime.definition.ai.preferredRange,
			runtime.stats.attackRange +
				MONSTER_DIRECTOR_CONFIG.preferredRangePadding,
		);
		const retreat = Math.min(
			preferred - MONSTER_DIRECTOR_CONFIG.preferredRangeBuffer,
			Math.max(0, runtime.definition.ai.retreatRange),
		);
		if (distance < retreat) {
			this.moveAway(
				monster,
				runtime,
				target.player,
				runtime.stats.moveSpeed,
				dtSeconds,
			);
			this.setAnimation(monster, 'walk', elapsedS);
			return true;
		}
		if (distance > preferred) {
			this.move(
				monster,
				runtime,
				target.player,
				runtime.stats.moveSpeed,
				dtSeconds,
				preferred,
			);
			this.setAnimation(monster, 'walk', elapsedS);
			return true;
		}
		this.face(monster, runtime, target.player);
		this.setAnimation(monster, 'attack', elapsedS);
		if (this.hot.attackCooldownS[runtime.slot] <= 0) {
			this.hitPlayer(
				runtime,
				target.sessionId,
				runtime.definition.ai.contactDamageMultiplier,
			);
			this.hot.attackCooldownS[runtime.slot] =
				runtime.stats.attackCooldownS;
		}
		this.useSpecialIfReady(monster, runtime, target, elapsedS);
		return true;
	}

	private updateCharger(
		monster: Monster,
		runtime: MonsterRuntime,
		target: Target,
		distance: number,
		dtSeconds: number,
		elapsedS: number,
	): boolean {
		const stopDistance =
			runtime.stats.attackRange + monster.hitboxRadius + PLAYER_HB_RADIUS;
		if (
			this.hot.chargeRemainingS[runtime.slot] <= 0 &&
			this.hot.chargeCooldownS[runtime.slot] <= 0 &&
			distance <= MONSTER_DIRECTOR_CONFIG.chargeTriggerDistance
		) {
			this.hot.chargeRemainingS[runtime.slot] =
				runtime.definition.ai.chargeDurationS;
			this.hot.chargeCooldownS[runtime.slot] =
				runtime.definition.ai.chargeCooldownS;
		}
		if (this.hot.chargeRemainingS[runtime.slot] > 0) {
			this.setAnimation(monster, 'attack', elapsedS);
			this.move(
				monster,
				runtime,
				target.player,
				runtime.stats.moveSpeed *
					runtime.definition.ai.chargeSpeedMultiplier,
				dtSeconds,
				stopDistance,
			);
			if (
				distance <= stopDistance &&
				this.claimAttackSlot(target.sessionId)
			) {
				if (this.hot.attackCooldownS[runtime.slot] <= 0) {
					this.hitPlayer(
						runtime,
						target.sessionId,
						runtime.definition.ai.chargeDamageMultiplier,
					);
					this.hot.attackCooldownS[runtime.slot] =
						runtime.stats.attackCooldownS;
				}
				this.hot.chargeRemainingS[runtime.slot] = 0;
			}
			return true;
		}
		return this.updateContact(
			monster,
			runtime,
			target,
			distance,
			dtSeconds,
			elapsedS,
		);
	}

	private updateBomber(
		id: string,
		monster: Monster,
		runtime: MonsterRuntime,
		target: Target,
		distance: number,
		dtSeconds: number,
		elapsedS: number,
	): boolean {
		const detonationDistance = Math.max(
			runtime.stats.attackRange + monster.hitboxRadius,
			runtime.definition.ai.specialRadius *
				MONSTER_DIRECTOR_CONFIG.bomberDetonationDistanceMultiplier,
		);
		if (distance <= detonationDistance) {
			this.setAnimation(monster, 'attack', elapsedS);
			this.damagePlayersInRadius(
				this.hot.positionX[runtime.slot],
				this.hot.positionZ[runtime.slot],
				runtime.definition.ai.specialRadius,
				runtime,
			);
			this.removalSet.add(id);
			this.removals.push(id);
			return true;
		}
		this.move(
			monster,
			runtime,
			target.player,
			runtime.stats.moveSpeed,
			dtSeconds,
			0,
		);
		this.setAnimation(monster, 'walk', elapsedS);
		return true;
	}

	private updateSummon(
		runtime: MonsterRuntime,
		monster: Monster,
		elapsedS: number,
	): void {
		if (this.hot.specialCooldownS[runtime.slot] > 0) return;
		const kind = runtime.definition.ai.summonKind;
		if (!kind) return;
		for (
			let index = 0;
			index < runtime.definition.ai.summonCount;
			index++
		) {
			const angle =
				(index / Math.max(1, runtime.definition.ai.summonCount)) * TAU +
				elapsedS;
			this.spawnChild(
				kind,
				this.hot.positionX[runtime.slot] +
					Math.cos(angle) * MONSTER_DIRECTOR_CONFIG.summonSpawnRadius,
				this.hot.positionZ[runtime.slot] +
					Math.sin(angle) * MONSTER_DIRECTOR_CONFIG.summonSpawnRadius,
			);
		}
		this.hot.specialCooldownS[runtime.slot] =
			runtime.definition.ai.specialCooldownS;
		this.setAnimation(monster, 'attack', elapsedS);
	}

	private updateBoss(
		monster: Monster,
		runtime: MonsterRuntime,
		target: Target,
		distance: number,
		dtSeconds: number,
		elapsedS: number,
	): boolean {
		const preferred = runtime.definition.ai.preferredRange;
		if (preferred > 0)
			this.updatePreferredDistance(
				monster,
				runtime,
				target,
				distance,
				dtSeconds,
				elapsedS,
			);
		else
			this.updateContact(
				monster,
				runtime,
				target,
				distance,
				dtSeconds,
				elapsedS,
			);
		this.useSpecialIfReady(monster, runtime, target, elapsedS);
		return true;
	}

	private updatePreferredDistance(
		monster: Monster,
		runtime: MonsterRuntime,
		target: Target,
		distance: number,
		dtSeconds: number,
		elapsedS: number,
	): boolean {
		const preferred = Math.max(
			runtime.definition.ai.preferredRange,
			runtime.stats.attackRange +
				MONSTER_DIRECTOR_CONFIG.preferredRangePadding,
		);
		const retreat = Math.min(
			preferred - MONSTER_DIRECTOR_CONFIG.preferredRangeBuffer,
			Math.max(0, runtime.definition.ai.retreatRange),
		);
		if (distance < retreat)
			this.moveAway(
				monster,
				runtime,
				target.player,
				runtime.stats.moveSpeed,
				dtSeconds,
			);
		else if (distance > preferred)
			this.move(
				monster,
				runtime,
				target.player,
				runtime.stats.moveSpeed,
				dtSeconds,
				preferred,
			);
		else this.face(monster, runtime, target.player);
		this.setAnimation(
			monster,
			distance >= retreat && distance <= preferred ? 'attack' : 'walk',
			elapsedS,
		);
		if (
			distance >= retreat &&
			distance <= preferred &&
			this.hot.attackCooldownS[runtime.slot] <= 0
		) {
			this.hitPlayer(
				runtime,
				target.sessionId,
				runtime.definition.ai.contactDamageMultiplier,
			);
			this.hot.attackCooldownS[runtime.slot] =
				runtime.stats.attackCooldownS;
		}
		return true;
	}

	private useSpecialIfReady(
		monster: Monster,
		runtime: MonsterRuntime,
		target: Target,
		elapsedS: number,
	): void {
		const ai = runtime.definition.ai;
		if (
			ai.specialKind === 'none' ||
			this.hot.specialCooldownS[runtime.slot] > 0
		)
			return;
		if (ai.specialKind === 'summon') {
			this.updateSummon(runtime, monster, elapsedS);
			return;
		}
		if (ai.specialKind === 'slam') {
			this.damagePlayersInRadius(
				this.hot.positionX[runtime.slot],
				this.hot.positionZ[runtime.slot],
				ai.specialRadius,
				runtime,
			);
		} else {
			this.damagePlayersInRadius(
				target.player.x,
				target.player.z,
				ai.specialRadius,
				runtime,
			);
		}
		this.hot.specialCooldownS[runtime.slot] = ai.specialCooldownS;
		this.setAnimation(monster, 'attack', elapsedS);
	}

	private damagePlayersInRadius(
		x: number,
		z: number,
		radius: number,
		runtime: MonsterRuntime,
	): void {
		const radiusSquared = radius * radius;
		for (const target of this.targets) {
			const dx = target.player.x - x;
			const dz = target.player.z - z;
			if (dx * dx + dz * dz <= radiusSquared)
				this.hitPlayer(
					runtime,
					target.sessionId,
					runtime.definition.ai.specialDamageMultiplier,
				);
		}
	}

	private hitPlayer(
		runtime: MonsterRuntime,
		sessionId: string,
		damageMultiplier: number,
	): void {
		this.damage.damagePlayer(
			sessionId,
			runtime.stats.damage * Math.max(0, damageMultiplier),
		);
	}

	private claimAttackSlot(sessionId: string, isBoss = false): boolean {
		const current = this.attackSlots.get(sessionId) ?? 0;
		const maximum = isBoss
			? MONSTER_DIRECTOR_CONFIG.maxContactAttackersPerPlayer +
				MONSTER_DIRECTOR_CONFIG.bossContactAttackersBonus
			: MONSTER_DIRECTOR_CONFIG.maxContactAttackersPerPlayer;
		if (current >= maximum) return false;
		this.attackSlots.set(sessionId, current + 1);
		return true;
	}

	private selectTarget(runtime: MonsterRuntime): Target | undefined {
		if (!this.targets.length) return undefined;
		let nearest = this.targets[0];
		let nearestDistance = Number.POSITIVE_INFINITY;
		let current: Target | undefined;
		let currentDistance = Number.POSITIVE_INFINITY;
		for (const target of this.targets) {
			const distance = this.distanceSquared(runtime, target.player);
			if (distance < nearestDistance) {
				nearest = target;
				nearestDistance = distance;
			}
			if (target.sessionId === runtime.targetSessionId) {
				current = target;
				currentDistance = distance;
			}
		}
		if (
			current &&
			currentDistance <=
				nearestDistance *
					MONSTER_DIRECTOR_CONFIG.targetSwitchDistanceMultiplier ** 2
		)
			return current;
		return nearest;
	}

	private move(
		monster: Monster,
		runtime: MonsterRuntime,
		target: Vec2d,
		speed: number,
		dtSeconds: number,
		stopDistance = 0,
	): void {
		const slot = runtime.slot;
		this.pbdOrigin.x = this.hot.positionX[slot];
		this.pbdOrigin.z = this.hot.positionZ[slot];
		const step = chaseStep(
			this.pbdOrigin,
			target,
			speed,
			dtSeconds,
			stopDistance,
			this.chaseOutput,
		);
		this.publishRotation(monster, runtime, step.rotationY);
		this.applyDesiredPosition(monster, runtime, step.x, step.z);
	}

	private resolveTerrainMove(
		targetX: number,
		targetZ: number,
		currentY: number,
		footprintRadius: number,
	): Vec2d {
		if (this.world.isSmoothTerrain) {
			this.moveOutput.x = targetX;
			this.moveOutput.z = targetZ;
			return this.moveOutput;
		}
		const cellSize = this.world.CELL;
		const cellX = Math.floor(this.pbdOrigin.x / cellSize);
		const cellZ = Math.floor(this.pbdOrigin.z / cellSize);
		if (
			targetX - footprintRadius >= cellX * cellSize &&
			targetX + footprintRadius < (cellX + 1) * cellSize &&
			targetZ - footprintRadius >= cellZ * cellSize &&
			targetZ + footprintRadius < (cellZ + 1) * cellSize
		) {
			this.moveOutput.x = targetX;
			this.moveOutput.z = targetZ;
			return this.moveOutput;
		}
		return resolveTerrainCollision(
			this.world,
			this.pbdOrigin,
			targetX,
			targetZ,
			currentY,
			this.moveOutput,
			footprintRadius,
		);
	}

	private moveAway(
		monster: Monster,
		runtime: MonsterRuntime,
		target: Vec2d,
		speed: number,
		dtSeconds: number,
	): void {
		const slot = runtime.slot;
		const dx = this.hot.positionX[slot] - target.x;
		const dz = this.hot.positionZ[slot] - target.z;
		const length = Math.hypot(dx, dz) || 1;
		const desiredX =
			this.hot.positionX[slot] + (dx / length) * speed * dtSeconds;
		const desiredZ =
			this.hot.positionZ[slot] + (dz / length) * speed * dtSeconds;
		this.publishRotation(monster, runtime, Math.atan2(dx, dz));
		this.applyDesiredPosition(monster, runtime, desiredX, desiredZ);
	}

	private applyDesiredPosition(
		monster: Monster,
		runtime: MonsterRuntime,
		desiredX: number,
		desiredZ: number,
	): void {
		const slot = runtime.slot;
		this.pbdOrigin.x = this.hot.positionX[slot];
		this.pbdOrigin.z = this.hot.positionZ[slot];
		const resolved = this.resolveTerrainMove(
			desiredX,
			desiredZ,
			this.hot.positionY[slot],
			Math.max(PLAYER_HB_RADIUS, monster.hitboxRadius),
		);
		clampPositionToCircle(
			resolved,
			this.roomState.rayX,
			this.roomState.rayZ,
			PLAYER_ACCESS_RADIUS + MONSTER_DIRECTOR_CONFIG.boundaryPadding,
		);
		if (
			resolved.x !== this.hot.positionX[slot] ||
			resolved.z !== this.hot.positionZ[slot]
		)
			this.hot.groundDirty[slot] = 1;
		this.hot.positionX[slot] = resolved.x;
		this.hot.positionZ[slot] = resolved.z;
	}

	private face(
		monster: Monster,
		runtime: MonsterRuntime,
		target: Vec2d,
	): void {
		this.publishRotation(
			monster,
			runtime,
			Math.atan2(
				target.x - this.hot.positionX[runtime.slot],
				target.z - this.hot.positionZ[runtime.slot],
			),
		);
	}

	private publishPosition(
		monster: Monster,
		runtime: MonsterRuntime,
		x: number,
		z: number,
	): void {
		const slot = runtime.slot;
		const epsilon = MONSTER_DIRECTOR_CONFIG.positionPublishEpsilon;
		if (
			Math.abs(x - this.hot.publishedX[slot]) < epsilon &&
			Math.abs(z - this.hot.publishedZ[slot]) < epsilon
		)
			return;
		if (monster.x !== x) monster.x = x;
		if (monster.z !== z) monster.z = z;
		this.hot.publishedX[slot] = x;
		this.hot.publishedZ[slot] = z;
		const y = this.hot.positionY[slot];
		if (monster.y !== y) monster.y = y;
	}

	private syncExternalTransform(
		monster: Monster,
		runtime: MonsterRuntime,
	): void {
		const slot = runtime.slot;
		if (
			monster.x !== this.hot.publishedX[slot] ||
			monster.z !== this.hot.publishedZ[slot]
		) {
			this.hot.positionX[slot] = monster.x;
			this.hot.positionY[slot] = monster.y;
			this.hot.positionZ[slot] = monster.z;
			this.hot.publishedX[slot] = monster.x;
			this.hot.publishedZ[slot] = monster.z;
			this.hot.groundDirty[slot] = 0;
		}
		if (monster.rotationY !== this.hot.publishedRotationY[slot]) {
			this.hot.rotationY[slot] = monster.rotationY;
			this.hot.publishedRotationY[slot] = monster.rotationY;
		}
	}

	private publishRotation(
		monster: Monster,
		runtime: MonsterRuntime,
		rotationY: number,
	): void {
		const slot = runtime.slot;
		this.hot.rotationY[slot] = rotationY;
		if (!this.publishTransformsThisTick) return;
		const delta = Math.abs(
			Math.atan2(
				Math.sin(rotationY - monster.rotationY),
				Math.cos(rotationY - monster.rotationY),
			),
		);
		if (delta >= MONSTER_DIRECTOR_CONFIG.rotationPublishEpsilon) {
			monster.rotationY = rotationY;
			this.hot.publishedRotationY[slot] = rotationY;
		}
	}

	private setAnimation(
		monster: Monster,
		state: Monster['animState'],
		elapsedS: number,
	): void {
		if (monster.animState === state) return;
		monster.animState = state;
		monster.animStartedAtS = elapsedS;
	}

	private distance(a: MonsterRuntime, b: Vec2d): number {
		return Math.sqrt(this.distanceSquared(a, b));
	}

	private distanceSquared(a: MonsterRuntime, b: Vec2d): number {
		const dx = this.hot.positionX[a.slot] - b.x;
		const dz = this.hot.positionZ[a.slot] - b.z;
		return dx * dx + dz * dz;
	}
}
