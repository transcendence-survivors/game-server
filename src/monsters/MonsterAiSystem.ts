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
import { MonsterSlots } from './MonsterSlots';
import type { MonsterRuntime } from './MonsterRuntime';
import { MonsterCrowdSolver } from './MonsterCrowdSolver';
import type { MonsterTransform } from './MonsterSimulationSource';

interface Target {
	sessionId: string;
	player: Player;
}

type RequestSpawn = (kind: string, x: number, z: number) => void;

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
	private readonly attackersPerPlayer = new Map<string, number>();
	private readonly selfDestructedIds: string[] = [];
	private readonly selfDestructedIdSet = new Set<string>();
	private readonly crowdMonsters: Monster[] = [];
	private readonly crowdRuntimes: MonsterRuntime[] = [];
	private readonly crowdMonsterIds: string[] = [];
	private readonly unindexedMonsterIds: string[] = [];
	private readonly nearbyCrowdIndices: number[] = [];
	private readonly slots = new MonsterSlots();
	private readonly tick = {} as MonsterTick;
	private readonly freeSlots: number[] = [];
	private nextSlot = 0;
	private timeSinceTransformPublishS = 0;
	private publishTransformsThisTick = false;
	private readonly crowdSolver = new MonsterCrowdSolver();
	private readonly clampedPosition = { x: 0, z: 0 };
	private readonly chaseStart = { x: 0, z: 0 };
	private readonly chaseStepResult = {
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
		private readonly requestSpawn: RequestSpawn,
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
		const slot = this.freeSlots.pop() ?? this.nextSlot++;
		runtime.slot = slot;
		this.slots.initialize(slot, monster, runtime);
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
		this.freeSlots.push(runtime.slot);
		runtime.slot = -1;
		runtime.activeIndex = -1;
	}

	lastPosition(runtime: MonsterRuntime): Vec2d {
		return {
			x: this.slots.lastX[runtime.slot],
			z: this.slots.lastZ[runtime.slot],
		};
	}

	readTransform(
		runtime: MonsterRuntime,
		output: MonsterTransform,
		monster?: Monster,
	): void {
		if (monster) this.adoptExternalTransform(monster, runtime);
		const slot = runtime.slot;
		output.x = this.slots.positionX[slot];
		output.y = this.slots.positionY[slot];
		output.z = this.slots.positionZ[slot];
		output.rotationY = this.slots.rotationY[slot];
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
			this.nearbyCrowdIndices,
		);
		result.length = 0;
		for (const index of this.nearbyCrowdIndices) {
			const id = this.crowdMonsterIds[index];
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
		this.slots.knockbackVelocityX[slot] += directionX * addedSpeed;
		this.slots.knockbackVelocityZ[slot] += directionZ * addedSpeed;
		const speed = Math.hypot(
			this.slots.knockbackVelocityX[slot],
			this.slots.knockbackVelocityZ[slot],
		);
		const maximumSpeed = MONSTER_DIRECTOR_CONFIG.knockbackMaximumSpeed;
		if (speed > maximumSpeed) {
			const scale = maximumSpeed / speed;
			this.slots.knockbackVelocityX[slot] *= scale;
			this.slots.knockbackVelocityZ[slot] *= scale;
		}
		this.slots.knockbackRemainingS[slot] = Math.max(
			this.slots.knockbackRemainingS[slot],
			duration,
		);
	}

	update(dtSeconds: number, elapsedS: number): readonly string[] {
		this.timeSinceTransformPublishS += dtSeconds;
		const publishInterval =
			MONSTER_DIRECTOR_CONFIG.monsterTransformPublishIntervalS;
		this.publishTransformsThisTick =
			this.timeSinceTransformPublishS + 1e-9 >= publishInterval;
		if (this.publishTransformsThisTick) {
			this.timeSinceTransformPublishS =
				this.timeSinceTransformPublishS < publishInterval
					? 0
					: this.timeSinceTransformPublishS % publishInterval;
		}
		let targetCount = 0;
		this.attackersPerPlayer.clear();
		this.selfDestructedIds.length = 0;
		this.selfDestructedIdSet.clear();
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
			this.slots.knockedBack[slot] = 0;
			this.adoptExternalTransform(monster, runtime);
			this.slots.lastX[slot] = this.slots.positionX[slot];
			this.slots.lastZ[slot] = this.slots.positionZ[slot];
			for (const key of COUNTDOWNS)
				this.slots[key][slot] = Math.max(
					0,
					this.slots[key][slot] - dtSeconds,
				);
			if (this.advanceKnockback(runtime, dtSeconds)) {
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
			this.runBehavior(tick);
		}
		this.separateCrowd();
		return this.selfDestructedIds;
	}

	private separateCrowd(): void {
		this.crowdMonsters.length = 0;
		this.crowdRuntimes.length = 0;
		this.crowdMonsterIds.length = 0;
		this.crowdSolver.reset();
		for (let index = 0; index < this.monsters.length; index++) {
			const id = this.monsterIds[index];
			const monster = this.monsters[index];
			const runtime = this.activeRuntimes[index];
			if (
				!this.selfDestructedIdSet.has(id) &&
				!monster.life.isDepleted() &&
				runtime.slot >= 0
			) {
				this.crowdMonsters.push(monster);
				this.crowdRuntimes.push(runtime);
				this.crowdMonsterIds.push(id);
				this.crowdSolver.add(
					this.slots.positionX[runtime.slot],
					this.slots.positionZ[runtime.slot],
					monster.hitboxRadius,
					monster.rank === 'boss',
					this.slots.knockedBack[runtime.slot] !== 0,
				);
			}
		}
		this.crowdSolver.solve();
		this.unindexedMonsterIds.length = 0;
		for (let index = 0; index < this.crowdMonsters.length; index++) {
			const monster = this.crowdMonsters[index];
			const runtime = this.crowdRuntimes[index];
			const slot = runtime.slot;
			const desiredX = this.crowdSolver.positionX(index);
			const desiredZ = this.crowdSolver.positionZ(index);
			let finalX = desiredX;
			let finalZ = desiredZ;
			if (
				desiredX !== this.slots.positionX[slot] ||
				desiredZ !== this.slots.positionZ[slot]
			) {
				const resolved = this.clampedPosition;
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
				finalX !== this.slots.positionX[slot] ||
				finalZ !== this.slots.positionZ[slot]
			)
				this.slots.groundDirty[slot] = 1;
			this.slots.positionX[slot] = finalX;
			this.slots.positionZ[slot] = finalZ;
			if (this.slots.groundDirty[slot]) {
				this.slots.positionY[slot] = this.world.height(finalX, finalZ);
				this.slots.groundDirty[slot] = 0;
			}
			this.slots.lastX[slot] = finalX;
			this.slots.lastZ[slot] = finalZ;
			if (
				this.publishTransformsThisTick ||
				this.slots.knockedBack[slot] !== 0
			)
				this.publishPosition(monster, runtime, finalX, finalZ);
		}
	}

	private advanceKnockback(
		runtime: MonsterRuntime,
		dtSeconds: number,
	): boolean {
		const slot = runtime.slot;
		const remaining = this.slots.knockbackRemainingS[slot];
		if (remaining <= 0) return false;
		const step = Math.min(dtSeconds, remaining);
		const integrationScale = step * (1 - (step * 0.5) / remaining);
		const desiredX =
			this.slots.positionX[slot] +
			this.slots.knockbackVelocityX[slot] * integrationScale;
		const desiredZ =
			this.slots.positionZ[slot] +
			this.slots.knockbackVelocityZ[slot] * integrationScale;
		const originX = this.slots.positionX[slot];
		const originZ = this.slots.positionZ[slot];
		this.applyDesiredPosition(runtime, desiredX, desiredZ);
		const remainingAfter = Math.max(0, remaining - step);
		const velocityScale = remainingAfter / remaining;
		this.slots.knockbackVelocityX[slot] *= velocityScale;
		this.slots.knockbackVelocityZ[slot] *= velocityScale;
		this.slots.knockbackRemainingS[slot] = remainingAfter;
		this.slots.knockedBack[slot] = 1;
		if (remainingAfter <= Number.EPSILON) {
			this.slots.knockbackVelocityX[slot] = 0;
			this.slots.knockbackVelocityZ[slot] = 0;
		} else {
			const desiredDx = desiredX - originX;
			const desiredDz = desiredZ - originZ;
			const actualDx = this.slots.positionX[slot] - originX;
			const actualDz = this.slots.positionZ[slot] - originZ;
			const desiredDistanceSquared =
				desiredDx * desiredDx + desiredDz * desiredDz;
			const actualDistanceSquared =
				actualDx * actualDx + actualDz * actualDz;
			if (
				desiredDistanceSquared <= Number.EPSILON ||
				actualDistanceSquared < desiredDistanceSquared * 0.04
			) {
				this.slots.knockbackVelocityX[slot] = 0;
				this.slots.knockbackVelocityZ[slot] = 0;
				this.slots.knockbackRemainingS[slot] = 0;
			} else {
				const actualDistance = Math.sqrt(actualDistanceSquared);
				const speed = Math.hypot(
					this.slots.knockbackVelocityX[slot],
					this.slots.knockbackVelocityZ[slot],
				);
				this.slots.knockbackVelocityX[slot] =
					(actualDx / actualDistance) * speed;
				this.slots.knockbackVelocityZ[slot] =
					(actualDz / actualDistance) * speed;
			}
		}
		return true;
	}

	private runBehavior(tick: MonsterTick): void {
		const { runtime } = tick;
		const ai = runtime.definition.ai;
		if (ai.kind === 'bomber') return this.runBomber(tick);
		if (ai.kind === 'charger') return this.runCharger(tick);
		if (ai.kind === 'ranged') return this.runRanged(tick);
		if (ai.kind === 'summoner') {
			this.summonIfReady(tick);
			this.keepPreferredDistance(tick);
			return;
		}
		if (ai.kind === 'boss') return this.runBoss(tick);

		return this.runContact(tick);
	}

	private runContact(tick: MonsterTick): void {
		const { monster, runtime, target, distance, elapsedS } = tick;
		const ai = runtime.definition.ai;
		const stopDistance = contactRange(monster, runtime);
		if (distance <= stopDistance) {
			if (
				!this.reserveAttacker(target.sessionId, monster.rank === 'boss')
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

	private runRanged(tick: MonsterTick): void {
		if (this.keepPreferredDistance(tick)) this.useSpecialIfReady(tick);
	}

	private runCharger(tick: MonsterTick): void {
		const { monster, runtime, target, distance, elapsedS } = tick;
		const stopDistance = contactRange(monster, runtime);
		if (
			this.slots.chargeRemainingS[runtime.slot] <= 0 &&
			this.slots.chargeCooldownS[runtime.slot] <= 0 &&
			distance <= MONSTER_DIRECTOR_CONFIG.chargeTriggerDistance
		) {
			this.slots.chargeRemainingS[runtime.slot] =
				runtime.definition.ai.chargeDurationS;
			this.slots.chargeCooldownS[runtime.slot] =
				runtime.definition.ai.chargeCooldownS;
		}
		if (this.slots.chargeRemainingS[runtime.slot] > 0) {
			this.setAnimation(monster, 'attack', elapsedS);
			this.move(
				tick,
				runtime.stats.moveSpeed *
					runtime.definition.ai.chargeSpeedMultiplier,
				stopDistance,
			);
			if (
				distance <= stopDistance &&
				this.reserveAttacker(target.sessionId)
			) {
				this.attackIfReady(
					tick,
					runtime.definition.ai.chargeDamageMultiplier,
				);
				this.slots.chargeRemainingS[runtime.slot] = 0;
			}
			return;
		}
		return this.runContact(tick);
	}

	private runBomber(tick: MonsterTick): void {
		const { id, monster, runtime, distance, elapsedS } = tick;
		const detonationDistance = Math.max(
			runtime.stats.attackRange + monster.hitboxRadius,
			runtime.definition.ai.specialRadius *
				MONSTER_DIRECTOR_CONFIG.bomberDetonationDistanceMultiplier,
		);
		if (distance <= detonationDistance) {
			this.setAnimation(monster, 'attack', elapsedS);
			this.damagePlayersInRadius(
				this.slots.positionX[runtime.slot],
				this.slots.positionZ[runtime.slot],
				runtime.definition.ai.specialRadius,
				runtime,
			);
			this.selfDestructedIdSet.add(id);
			this.selfDestructedIds.push(id);
			return;
		}
		this.move(tick, runtime.stats.moveSpeed);
		this.setAnimation(monster, 'walk', elapsedS);
	}

	private summonIfReady(tick: MonsterTick): void {
		const { runtime, monster, elapsedS } = tick;
		if (this.slots.specialCooldownS[runtime.slot] > 0) return;
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
			this.requestSpawn(
				kind,
				this.slots.positionX[runtime.slot] +
					Math.cos(angle) * MONSTER_DIRECTOR_CONFIG.summonSpawnRadius,
				this.slots.positionZ[runtime.slot] +
					Math.sin(angle) * MONSTER_DIRECTOR_CONFIG.summonSpawnRadius,
			);
		}
		this.slots.specialCooldownS[runtime.slot] =
			runtime.definition.ai.specialCooldownS;
		this.setAnimation(monster, 'attack', elapsedS);
	}

	private runBoss(tick: MonsterTick): void {
		if (tick.runtime.definition.ai.preferredRange > 0)
			this.keepPreferredDistance(tick);
		else this.runContact(tick);
		this.useSpecialIfReady(tick);
	}

	private keepPreferredDistance(tick: MonsterTick): boolean {
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
			this.slots.specialCooldownS[runtime.slot] > 0
		)
			return;
		if (ai.specialKind === 'summon') {
			this.summonIfReady(tick);
			return;
		}
		const onSelf = ai.specialKind === 'slam';
		this.damagePlayersInRadius(
			onSelf ? this.slots.positionX[runtime.slot] : target.player.x,
			onSelf ? this.slots.positionZ[runtime.slot] : target.player.z,
			ai.specialRadius,
			runtime,
		);
		this.slots.specialCooldownS[runtime.slot] = ai.specialCooldownS;
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
		if (this.slots.attackCooldownS[runtime.slot] > 0) return;
		this.hitPlayer(runtime, target.sessionId, damageMultiplier);
		this.slots.attackCooldownS[runtime.slot] =
			runtime.stats.attackCooldownS;
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

	private reserveAttacker(sessionId: string, isBoss = false): boolean {
		const current = this.attackersPerPlayer.get(sessionId) ?? 0;
		const maximum = isBoss
			? MONSTER_DIRECTOR_CONFIG.maxContactAttackersPerPlayer +
				MONSTER_DIRECTOR_CONFIG.bossContactAttackersBonus
			: MONSTER_DIRECTOR_CONFIG.maxContactAttackersPerPlayer;
		if (current >= maximum) return false;
		this.attackersPerPlayer.set(sessionId, current + 1);
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
		this.chaseStart.x = this.slots.positionX[slot];
		this.chaseStart.z = this.slots.positionZ[slot];
		const step = chaseStep(
			this.chaseStart,
			target.player,
			speed,
			dtSeconds,
			stopDistance,
			this.chaseStepResult,
		);
		this.publishRotation(monster, runtime, step.rotationY);
		this.applyDesiredPosition(runtime, step.x, step.z);
	}

	private moveAway(tick: MonsterTick, speed: number): void {
		const { monster, runtime, target, dtSeconds } = tick;
		const slot = runtime.slot;
		const dx = this.slots.positionX[slot] - target.player.x;
		const dz = this.slots.positionZ[slot] - target.player.z;
		const length = Math.hypot(dx, dz) || 1;
		const desiredX =
			this.slots.positionX[slot] + (dx / length) * speed * dtSeconds;
		const desiredZ =
			this.slots.positionZ[slot] + (dz / length) * speed * dtSeconds;
		this.publishRotation(monster, runtime, Math.atan2(dx, dz));
		this.applyDesiredPosition(runtime, desiredX, desiredZ);
	}

	private applyDesiredPosition(
		runtime: MonsterRuntime,
		desiredX: number,
		desiredZ: number,
	): void {
		const slot = runtime.slot;
		const resolved = this.clampedPosition;
		resolved.x = desiredX;
		resolved.z = desiredZ;
		clampPositionToCircle(
			resolved,
			this.roomState.rayX,
			this.roomState.rayZ,
			PLAYER_ACCESS_RADIUS + MONSTER_DIRECTOR_CONFIG.boundaryPadding,
		);
		if (
			resolved.x !== this.slots.positionX[slot] ||
			resolved.z !== this.slots.positionZ[slot]
		)
			this.slots.groundDirty[slot] = 1;
		this.slots.positionX[slot] = resolved.x;
		this.slots.positionZ[slot] = resolved.z;
	}

	private face(tick: MonsterTick): void {
		const { monster, runtime, target } = tick;
		this.publishRotation(
			monster,
			runtime,
			Math.atan2(
				target.player.x - this.slots.positionX[runtime.slot],
				target.player.z - this.slots.positionZ[runtime.slot],
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
			Math.abs(x - this.slots.publishedX[slot]) < epsilon &&
			Math.abs(z - this.slots.publishedZ[slot]) < epsilon
		)
			return;
		if (monster.x !== x) monster.x = x;
		if (monster.z !== z) monster.z = z;
		this.slots.publishedX[slot] = x;
		this.slots.publishedZ[slot] = z;
		const y = this.slots.positionY[slot];
		if (monster.y !== y) monster.y = y;
	}

	private adoptExternalTransform(
		monster: Monster,
		runtime: MonsterRuntime,
	): void {
		const slot = runtime.slot;
		if (
			monster.x !== this.slots.publishedX[slot] ||
			monster.z !== this.slots.publishedZ[slot]
		) {
			this.slots.positionX[slot] = monster.x;
			this.slots.positionY[slot] = monster.y;
			this.slots.positionZ[slot] = monster.z;
			this.slots.publishedX[slot] = monster.x;
			this.slots.publishedZ[slot] = monster.z;
			this.slots.groundDirty[slot] = 0;
		}
		if (monster.rotationY !== this.slots.publishedRotationY[slot]) {
			this.slots.rotationY[slot] = monster.rotationY;
			this.slots.publishedRotationY[slot] = monster.rotationY;
		}
	}

	private publishRotation(
		monster: Monster,
		runtime: MonsterRuntime,
		rotationY: number,
	): void {
		const slot = runtime.slot;
		this.slots.rotationY[slot] = rotationY;
		if (!this.publishTransformsThisTick) return;
		const delta = Math.abs(
			Math.atan2(
				Math.sin(rotationY - monster.rotationY),
				Math.cos(rotationY - monster.rotationY),
			),
		);
		if (delta >= MONSTER_DIRECTOR_CONFIG.rotationPublishEpsilon) {
			monster.rotationY = rotationY;
			this.slots.publishedRotationY[slot] = rotationY;
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
		const dx = this.slots.positionX[a.slot] - b.x;
		const dz = this.slots.positionZ[a.slot] - b.z;
		return dx * dx + dz * dz;
	}
}
