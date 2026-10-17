import {
	chaseStep,
	clampPositionToCircle,
	MONSTER_DIRECTOR_CONFIG,
	TAU,
	PLAYER_ACCESS_RADIUS,
	PLAYER_HB_RADIUS,
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

interface MonsterTick {
	id: string;
	monster: Monster;
	runtime: MonsterRuntime;
	target: Target;
	distance: number;
	dtSeconds: number;
	elapsedS: number;
}

function contactRange(monster: Monster, runtime: MonsterRuntime): number {
	return runtime.stats.attackRange + monster.hitboxRadius + PLAYER_HB_RADIUS;
}

const COUNTDOWNS = [
	'attackCooldownS',
	'specialCooldownS',
	'chargeCooldownS',
	'chargeRemainingS',
] as const;

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
	private readonly hot = new MonsterHotState();
	private readonly tick = {} as MonsterTick;
	private readonly freeHotSlots: number[] = [];
	private nextHotSlot = 0;
	private transformPublishAccumulatorS = 0;
	private publishTransformsThisTick = false;
	private readonly crowdSolver = new MonsterPbdSolver();
	private readonly moveOutput = { x: 0, z: 0 };
	private readonly chaseOrigin = { x: 0, z: 0 };
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
			const runtime = this.activeRuntimes[index];
			if (monster.life.isDepleted()) continue;
			const slot = runtime.slot;
			this.hot.knockedBack[slot] = 0;
			this.syncExternalTransform(monster, runtime);
			this.hot.lastX[slot] = this.hot.positionX[slot];
			this.hot.lastZ[slot] = this.hot.positionZ[slot];
			for (const key of COUNTDOWNS)
				this.hot[key][slot] = Math.max(
					0,
					this.hot[key][slot] - dtSeconds,
				);
			if (this.applyKnockbackImpulse(runtime, dtSeconds)) {
				this.setAnimation(monster, 'idle', elapsedS);
				continue;
			}

			const target = this.selectTarget(runtime);
			if (!target) {
				this.setAnimation(monster, 'idle', elapsedS);
				continue;
			}
			runtime.targetSessionId = target.sessionId;
			const tick = this.tick;
			tick.id = id;
			tick.monster = monster;
			tick.runtime = runtime;
			tick.target = target;
			tick.distance = this.distance(runtime, target.player);
			tick.dtSeconds = dtSeconds;
			tick.elapsedS = elapsedS;
			this.updateBehavior(tick);
		}
		this.solveCrowdContacts();
		return this.removals;
	}

	private solveCrowdContacts(): void {
		this.pbdMonsters.length = 0;
		this.pbdRuntimes.length = 0;
		this.pbdMonsterIds.length = 0;
		this.crowdSolver.reset();
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
				this.crowdSolver.add(
					this.hot.positionX[runtime.slot],
					this.hot.positionZ[runtime.slot],
					monster.hitboxRadius,
					monster.rank === 'boss',
					this.hot.knockedBack[runtime.slot] !== 0,
				);
			}
		}
		this.crowdSolver.solve();
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
				const resolved = this.moveOutput;
				resolved.x = desiredX;
				resolved.z = desiredZ;
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
				this.hot.knockedBack[slot] !== 0
			)
				this.publishPosition(monster, runtime, finalX, finalZ);
		}
	}

	private applyKnockbackImpulse(
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
		this.applyDesiredPosition(runtime, desiredX, desiredZ);
		const remainingAfter = Math.max(0, remaining - step);
		const velocityScale = remainingAfter / remaining;
		this.hot.knockbackVelocityX[slot] *= velocityScale;
		this.hot.knockbackVelocityZ[slot] *= velocityScale;
		this.hot.knockbackRemainingS[slot] = remainingAfter;
		this.hot.knockedBack[slot] = 1;
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

	private updateBehavior(tick: MonsterTick): void {
		const { runtime } = tick;
		const ai = runtime.definition.ai;
		if (ai.kind === 'bomber') return this.updateBomber(tick);
		if (ai.kind === 'charger') return this.updateCharger(tick);
		if (ai.kind === 'ranged') return this.updateRanged(tick);
		if (ai.kind === 'summoner') {
			this.updateSummon(tick);
			this.updatePreferredDistance(tick);
			return;
		}
		if (ai.kind === 'boss') return this.updateBoss(tick);

		return this.updateContact(tick);
	}

	private updateContact(tick: MonsterTick): void {
		const { monster, runtime, target, distance, elapsedS } = tick;
		const ai = runtime.definition.ai;
		const stopDistance = contactRange(monster, runtime);
		if (distance <= stopDistance) {
			if (
				!this.claimAttackSlot(target.sessionId, monster.rank === 'boss')
			) {
				this.move(tick, 0);
				this.setAnimation(monster, 'walk', elapsedS);
				return;
			}
			this.setAnimation(monster, 'attack', elapsedS);
			this.attackIfReady(tick, ai.contactDamageMultiplier);
			return;
		}
		this.move(
			tick,
			runtime.stats.moveSpeed * ai.movementSpeedMultiplier,
			stopDistance,
		);
		this.setAnimation(monster, 'walk', elapsedS);
	}

	private updateRanged(tick: MonsterTick): void {
		if (this.updatePreferredDistance(tick)) this.useSpecialIfReady(tick);
	}

	private updateCharger(tick: MonsterTick): void {
		const { monster, runtime, target, distance, elapsedS } = tick;
		const stopDistance = contactRange(monster, runtime);
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
				tick,
				runtime.stats.moveSpeed *
					runtime.definition.ai.chargeSpeedMultiplier,
				stopDistance,
			);
			if (
				distance <= stopDistance &&
				this.claimAttackSlot(target.sessionId)
			) {
				this.attackIfReady(
					tick,
					runtime.definition.ai.chargeDamageMultiplier,
				);
				this.hot.chargeRemainingS[runtime.slot] = 0;
			}
			return;
		}
		return this.updateContact(tick);
	}

	private updateBomber(tick: MonsterTick): void {
		const { id, monster, runtime, distance, elapsedS } = tick;
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
			return;
		}
		this.move(tick, runtime.stats.moveSpeed);
		this.setAnimation(monster, 'walk', elapsedS);
	}

	private updateSummon(tick: MonsterTick): void {
		const { runtime, monster, elapsedS } = tick;
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

	private updateBoss(tick: MonsterTick): void {
		if (tick.runtime.definition.ai.preferredRange > 0)
			this.updatePreferredDistance(tick);
		else this.updateContact(tick);
		this.useSpecialIfReady(tick);
	}

	private updatePreferredDistance(tick: MonsterTick): boolean {
		const { monster, runtime, distance, elapsedS } = tick;
		const preferred = Math.max(
			runtime.definition.ai.preferredRange,
			runtime.stats.attackRange +
				MONSTER_DIRECTOR_CONFIG.preferredRangePadding,
		);
		const retreat = Math.min(
			preferred - MONSTER_DIRECTOR_CONFIG.preferredRangeBuffer,
			Math.max(0, runtime.definition.ai.retreatRange),
		);
		if (distance < retreat) this.moveAway(tick, runtime.stats.moveSpeed);
		else if (distance > preferred)
			this.move(tick, runtime.stats.moveSpeed, preferred);
		else this.face(tick);
		const inRange = distance >= retreat && distance <= preferred;
		this.setAnimation(monster, inRange ? 'attack' : 'walk', elapsedS);
		if (inRange)
			this.attackIfReady(
				tick,
				runtime.definition.ai.contactDamageMultiplier,
			);
		return inRange;
	}

	private useSpecialIfReady(tick: MonsterTick): void {
		const { monster, runtime, target, elapsedS } = tick;
		const ai = runtime.definition.ai;
		if (
			ai.specialKind === 'none' ||
			this.hot.specialCooldownS[runtime.slot] > 0
		)
			return;
		if (ai.specialKind === 'summon') {
			this.updateSummon(tick);
			return;
		}
		const onSelf = ai.specialKind === 'slam';
		this.damagePlayersInRadius(
			onSelf ? this.hot.positionX[runtime.slot] : target.player.x,
			onSelf ? this.hot.positionZ[runtime.slot] : target.player.z,
			ai.specialRadius,
			runtime,
		);
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

	private attackIfReady(tick: MonsterTick, damageMultiplier: number): void {
		const { runtime, target } = tick;
		if (this.hot.attackCooldownS[runtime.slot] > 0) return;
		this.hitPlayer(runtime, target.sessionId, damageMultiplier);
		this.hot.attackCooldownS[runtime.slot] = runtime.stats.attackCooldownS;
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

	private move(tick: MonsterTick, speed: number, stopDistance = 0): void {
		const { monster, runtime, target, dtSeconds } = tick;
		const slot = runtime.slot;
		this.chaseOrigin.x = this.hot.positionX[slot];
		this.chaseOrigin.z = this.hot.positionZ[slot];
		const step = chaseStep(
			this.chaseOrigin,
			target.player,
			speed,
			dtSeconds,
			stopDistance,
			this.chaseOutput,
		);
		this.publishRotation(monster, runtime, step.rotationY);
		this.applyDesiredPosition(runtime, step.x, step.z);
	}

	private moveAway(tick: MonsterTick, speed: number): void {
		const { monster, runtime, target, dtSeconds } = tick;
		const slot = runtime.slot;
		const dx = this.hot.positionX[slot] - target.player.x;
		const dz = this.hot.positionZ[slot] - target.player.z;
		const length = Math.hypot(dx, dz) || 1;
		const desiredX =
			this.hot.positionX[slot] + (dx / length) * speed * dtSeconds;
		const desiredZ =
			this.hot.positionZ[slot] + (dz / length) * speed * dtSeconds;
		this.publishRotation(monster, runtime, Math.atan2(dx, dz));
		this.applyDesiredPosition(runtime, desiredX, desiredZ);
	}

	private applyDesiredPosition(
		runtime: MonsterRuntime,
		desiredX: number,
		desiredZ: number,
	): void {
		const slot = runtime.slot;
		const resolved = this.moveOutput;
		resolved.x = desiredX;
		resolved.z = desiredZ;
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

	private face(tick: MonsterTick): void {
		const { monster, runtime, target } = tick;
		this.publishRotation(
			monster,
			runtime,
			Math.atan2(
				target.player.x - this.hot.positionX[runtime.slot],
				target.player.z - this.hot.positionZ[runtime.slot],
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
