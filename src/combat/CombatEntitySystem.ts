import {
	COMBAT_LIMITS,
	CombatEntity,
	type CombatEntityKind,
	type CombatHitboxShape,
	type GameState,
	monsterHitboxPrimitives,
	type MonsterHitboxPrimitive,
	type MonsterWorldHitbox,
	type ProjectileDirection,
	type Vec3d,
	type WeaponKind,
} from '@transcendence/game-shared';
import type { DamageResolver } from './DamageResolver';
import { CombatEntityIndex } from './CombatEntityIndex';
import { MonsterSpatialIndex } from './MonsterSpatialIndex';
import type {
	MonsterSimulationSource,
	MonsterSpatialQuery,
	MonsterTransform,
} from '../monsters/MonsterSimulationSource';
import {
	ProjectileBehavior,
	StationaryProjectileBehavior,
	TargetedProjectileBehavior,
	ZoneBehavior,
	collectIntersectingMonsterIds,
	type CombatEntityRuntime,
	type CombatEntityUpdateContext,
} from './CombatEntityBehavior';

type CombatEntityBehaviorKind =
	| 'projectile'
	| 'persistent-zone'
	| 'stationary-projectile'
	| 'targeted-projectile'
	| 'temporary-attack';

export interface SpawnCombatEntity extends ProjectileDirection, Vec3d {
	kind: CombatEntityKind;
	weaponKind: WeaponKind;
	ownerSessionId: string;
	behavior: CombatEntityBehaviorKind;
	targetId?: string;
	rotationY?: number;
	scale?: number;
	lifetimeS: number;
	damage: number;
	collisionRadius: number;
	hitboxShape?: CombatHitboxShape;
	collisionHeight?: number;
	collisionWidth?: number;
	collisionDepth?: number;
	collisionHalfAngle?: number;
	velocityX?: number;
	velocityY?: number;
	velocityZ?: number;
	penetration?: number;
	contactIntervalS?: number;
	terrainOffset?: number;
	removeOnTerrainCollision?: boolean;
	travelDistance?: number;
	projectileSpeed?: number;
	maxTurnRateRadiansS?: number;
}

interface MonsterHitboxBuffers {
	posed: MonsterHitboxPrimitive[];
	world: [MonsterWorldHitbox[], MonsterWorldHitbox[]];
}

const BEHAVIORS = {
	projectile: new ProjectileBehavior(),
	'persistent-zone': new ZoneBehavior(true),
	'stationary-projectile': new StationaryProjectileBehavior(),
	'targeted-projectile': new TargetedProjectileBehavior(),
	'temporary-attack': new ZoneBehavior(false),
} as const;

export class CombatEntitySystem {
	private readonly runtime = new Map<string, CombatEntityRuntime>();
	private readonly monsterHitboxes = new Map<string, MonsterWorldHitbox[]>();
	private readonly monsterHitboxBuffers = new Map<
		string,
		MonsterHitboxBuffers
	>();
	private readonly monsterSpatialIndex = new MonsterSpatialIndex();
	private readonly entityIndex = new CombatEntityIndex();
	private readonly pendingOwnerCounts = new Map<string, number>();
	private readonly singleSpawn: SpawnCombatEntity[] = [];
	private readonly updateContext: CombatEntityUpdateContext;
	private monsterHitboxTimeS = Number.NaN;
	private monsterHitboxBufferIndex = 0;
	private monsterSpatialIndexTimeS = Number.NaN;
	private elapsedS = 0;
	private nextSequence = 1;
	private readonly monsterTransform: MonsterTransform = {
		x: 0,
		y: 0,
		z: 0,
		rotationY: 0,
	};

	constructor(
		private readonly roomState: GameState,
		damage: DamageResolver,
		terrainHeight: (x: number, z: number) => number,
		readonly monsterSimulation?: MonsterSimulationSource,
	) {
		this.updateContext = {
			state: roomState,
			damage,
			elapsedS: 0,
			terrainHeight,
			monsterHitboxes: this.monsterHitboxes,
			monsterSpatialIndex: this.monsterSpatialIndex,
			monsterSimulation,
			monsterTransform: this.monsterTransform,
			candidates: [],
			previous: { x: 0, y: 0, z: 0 },
			collisionShape: {
				x: 0,
				y: 0,
				z: 0,
				radius: 0,
				height: 0,
				rotationY: 0,
				halfAngle: 0,
			},
		};
	}

	spawn(input: SpawnCombatEntity): CombatEntity | undefined {
		this.singleSpawn[0] = input;
		if (!this.canSpawn(this.singleSpawn)) return undefined;
		return this.spawnUnchecked(input);
	}

	spawnBatch(inputs: readonly SpawnCombatEntity[]): boolean {
		if (!inputs.length || !this.canSpawn(inputs)) return false;
		for (const input of inputs) this.spawnUnchecked(input);
		return true;
	}

	monsterHitboxesAt(
		elapsedS: number,
	): ReadonlyMap<string, readonly MonsterWorldHitbox[]> {
		if (elapsedS === this.monsterHitboxTimeS) return this.monsterHitboxes;
		this.monsterHitboxTimeS = elapsedS;
		this.monsterHitboxBufferIndex = 1 - this.monsterHitboxBufferIndex;
		this.monsterHitboxes.clear();
		this.roomState.monsters.forEach((monster, id) => {
			let buffers = this.monsterHitboxBuffers.get(id);
			if (!buffers) {
				buffers = { posed: [], world: [[], []] };
				this.monsterHitboxBuffers.set(id, buffers);
			}
			const exact =
				this.monsterSimulation?.readTransform(
					id,
					this.monsterTransform,
				) ?? false;
			this.monsterHitboxes.set(
				id,
				monsterHitboxPrimitives(
					monster,
					elapsedS,
					buffers.world[this.monsterHitboxBufferIndex],
					buffers.posed,
					exact ? this.monsterTransform : undefined,
				),
			);
		});
		for (const id of this.monsterHitboxBuffers.keys())
			if (!this.roomState.monsters.has(id))
				this.monsterHitboxBuffers.delete(id);
		return this.monsterHitboxes;
	}

	queryMonsterIdsInRadius(
		elapsedS: number,
		x: number,
		z: number,
		radius: number,
		output: string[],
	): void {
		this.prepareMonsterSpatialIndex(elapsedS).queryRadius(
			x,
			z,
			radius,
			output,
		);
	}

	queryIntersectingMonsterIds(
		elapsedS: number,
		start: Vec3d,
		hitbox: CombatEntity,
		output: string[],
	): void {
		collectIntersectingMonsterIds(
			start,
			hitbox,
			this.prepareUpdateContext(elapsedS),
			output,
		);
	}

	private spawnUnchecked(input: SpawnCombatEntity): CombatEntity {
		const sequence = this.nextSequence++;
		const entity = new CombatEntity();
		entity.id = `${input.ownerSessionId}:${sequence}`;
		entity.kind = input.kind;
		entity.weaponKind = input.weaponKind;
		entity.ownerSessionId = input.ownerSessionId;
		entity.targetId = input.targetId ?? '';
		entity.x = input.x;
		entity.y = input.y;
		entity.z = input.z;
		entity.directionX = input.directionX ?? 0;
		entity.directionY = input.directionY ?? 0;
		entity.directionZ = input.directionZ ?? 0;
		entity.rotationY = input.rotationY ?? 0;
		entity.scale = input.scale ?? 1;
		entity.hitboxShape = input.hitboxShape ?? 'sphere';
		entity.hitboxRadius = input.collisionRadius;
		entity.hitboxHeight =
			input.collisionHeight ?? input.collisionRadius * 2;
		entity.hitboxWidth = input.collisionWidth ?? input.collisionRadius * 2;
		entity.hitboxDepth = input.collisionDepth ?? input.collisionRadius * 2;
		entity.hitboxHalfAngle = input.collisionHalfAngle ?? Math.PI / 2;
		entity.spawnSequence = sequence;
		entity.expiresAtS =
			this.elapsedS +
			Math.min(input.lifetimeS, COMBAT_LIMITS.maxEntityLifetimeS);
		this.roomState.combatEntities.set(entity.id, entity);
		this.entityIndex.add(entity);
		this.runtime.set(entity.id, {
			behavior: BEHAVIORS[input.behavior],
			damage: input.damage,
			velocityX: input.velocityX ?? 0,
			velocityY: input.velocityY ?? 0,
			velocityZ: input.velocityZ ?? 0,
			penetration: Math.max(0, Math.trunc(input.penetration ?? 0)),
			contactIntervalS: Math.max(0, input.contactIntervalS ?? Infinity),
			terrainOffset: input.terrainOffset ?? 0,
			removeOnTerrainCollision: input.removeOnTerrainCollision ?? false,
			travelRemaining: Math.max(0, input.travelDistance ?? 0),
			projectileSpeed: Math.max(0, input.projectileSpeed ?? 0),
			maxTurnRateRadiansS: Math.max(0, input.maxTurnRateRadiansS ?? 0),
		});
		return entity;
	}

	private canSpawn(inputs: readonly SpawnCombatEntity[]): boolean {
		for (const input of inputs)
			if (
				!this.roomState.players.has(input.ownerSessionId) ||
				!this.isFiniteInput(input)
			)
				return false;
		if (
			this.roomState.combatEntities.size + inputs.length >
			COMBAT_LIMITS.maxCombatEntitiesPerRoom
		)
			return false;
		const pendingCounts = this.pendingOwnerCounts;
		pendingCounts.clear();
		for (const input of inputs)
			pendingCounts.set(
				input.ownerSessionId,
				(pendingCounts.get(input.ownerSessionId) ?? 0) + 1,
			);
		for (const [ownerSessionId, pending] of pendingCounts)
			if (
				(this.entityIndex.owner(ownerSessionId)?.all.length ?? 0) +
					pending >
				COMBAT_LIMITS.maxProjectilesPerPlayer
			)
				return false;
		return true;
	}

	update(dtSeconds: number): void {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		this.elapsedS += dtSeconds;
		this.roomState.combatTimeS = this.elapsedS;
		const ids = this.entityIndex.orderedIds(this.roomState.combatEntities);
		if (!ids.length) return;
		const context = this.prepareUpdateContext(this.elapsedS);
		for (const id of ids) {
			const entity = this.roomState.combatEntities.get(id);
			const runtime = this.runtime.get(id);
			if (!entity || !runtime) {
				this.remove(id);
				continue;
			}
			if (!this.roomState.players.has(entity.ownerSessionId)) {
				this.remove(id);
				continue;
			}
			if (
				entity.targetId &&
				!this.roomState.monsters.has(entity.targetId)
			)
				entity.targetId = '';
			if (this.elapsedS >= entity.expiresAtS) {
				this.remove(id);
				continue;
			}
			const alive = runtime.behavior.update(
				entity,
				runtime,
				dtSeconds,
				context,
			);
			if (!alive) this.remove(id);
		}
	}

	removeOwner(ownerSessionId: string): void {
		const ids = this.entityIndex.owner(ownerSessionId)?.all.slice();
		if (!ids) return;
		for (const id of ids) this.remove(id);
	}

	removeOldestOwned(
		ownerSessionId: string,
		weaponKind: WeaponKind,
		maximumRemaining: number,
	): void {
		const owned = this.entityIndex
			.owner(ownerSessionId)
			?.weapons.get(weaponKind);
		if (!owned) return;
		const removeCount = owned.length - maximumRemaining;
		if (removeCount <= 0) return;
		for (let index = 0; index < removeCount; index++) this.remove(owned[0]);
	}

	private remove(id: string): void {
		const entity = this.roomState.combatEntities.get(id);
		if (entity) this.entityIndex.delete(entity);
		this.runtime.delete(id);
		this.roomState.combatEntities.delete(id);
	}

	private prepareMonsterSpatialIndex(elapsedS: number): MonsterSpatialQuery {
		if (this.monsterSimulation) return this.monsterSimulation;
		const hitboxes = this.monsterHitboxesAt(elapsedS);
		if (elapsedS !== this.monsterSpatialIndexTimeS) {
			this.monsterSpatialIndexTimeS = elapsedS;
			this.monsterSpatialIndex.rebuild(hitboxes);
		}
		return this.monsterSpatialIndex;
	}

	private prepareUpdateContext(elapsedS: number): CombatEntityUpdateContext {
		this.updateContext.elapsedS = elapsedS;
		this.updateContext.monsterHitboxes = this.monsterHitboxesAt(elapsedS);
		this.updateContext.monsterSpatialIndex =
			this.prepareMonsterSpatialIndex(elapsedS);
		return this.updateContext;
	}

	private isFiniteInput(input: SpawnCombatEntity): boolean {
		return (
			input.lifetimeS > 0 &&
			input.damage >= 0 &&
			input.collisionRadius >= 0 &&
			[
				input.x,
				input.y,
				input.z,
				input.lifetimeS,
				input.damage,
				input.collisionRadius,
				input.collisionHeight ?? input.collisionRadius * 2,
				input.collisionWidth ?? input.collisionRadius * 2,
				input.collisionDepth ?? input.collisionRadius * 2,
				input.collisionHalfAngle ?? Math.PI / 2,
				input.velocityX ?? 0,
				input.velocityY ?? 0,
				input.velocityZ ?? 0,
				input.contactIntervalS ?? 0,
				input.travelDistance ?? 0,
				input.projectileSpeed ?? 0,
				input.maxTurnRateRadiansS ?? 0,
			].every(Number.isFinite)
		);
	}
}
