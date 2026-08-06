import {
	COMBAT_LIMITS,
	CombatEntity,
	type CombatEntityKind,
	type GameState,
	type WeaponKind,
} from '../../../shared-package';
import type { DamageResolver } from './DamageResolver';
import {
	CombatEntityBehavior,
	PersistentZoneBehavior,
	ProjectileBehavior,
	TemporaryAttackBehavior,
	type CombatEntityRuntime,
} from './CombatEntityBehavior';

export type CombatEntityBehaviorKind =
	| 'projectile'
	| 'persistent-zone'
	| 'temporary-attack';

export interface SpawnCombatEntity {
	kind: CombatEntityKind;
	weaponKind: WeaponKind;
	ownerSessionId: string;
	behavior: CombatEntityBehaviorKind;
	targetId?: string;
	x: number;
	y: number;
	z: number;
	directionX?: number;
	directionY?: number;
	directionZ?: number;
	rotationY?: number;
	scale?: number;
	lifetimeS: number;
	damage: number;
	collisionRadius: number;
	velocityX?: number;
	velocityY?: number;
	velocityZ?: number;
	penetration?: number;
	contactIntervalS?: number;
	terrainOffset?: number;
	removeOnTerrainCollision?: boolean;
}

interface RuntimeEntry {
	behavior: CombatEntityBehavior;
	state: CombatEntityRuntime;
}

export class CombatEntitySystem {
	private readonly runtime = new Map<string, RuntimeEntry>();
	private elapsedS = 0;
	private nextSequence = 1;

	constructor(
		private readonly roomState: GameState,
		private readonly damage: DamageResolver,
		private readonly terrainHeight: (x: number, z: number) => number,
	) {}

	spawn(input: SpawnCombatEntity): CombatEntity | undefined {
		if (!this.roomState.players.has(input.ownerSessionId)) return undefined;
		if (!this.isFiniteInput(input)) return undefined;
		if (this.roomState.combatEntities.size >= COMBAT_LIMITS.maxCombatEntitiesPerRoom)
			return undefined;
		let owned = 0;
		this.roomState.combatEntities.forEach((entity) => {
			if (entity.ownerSessionId === input.ownerSessionId) owned++;
		});
		if (owned >= COMBAT_LIMITS.maxProjectilesPerPlayer) return undefined;
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
		entity.spawnSequence = sequence;
		entity.createdAtS = this.elapsedS;
		entity.expiresAtS =
			this.elapsedS + Math.min(input.lifetimeS, COMBAT_LIMITS.maxEntityLifetimeS);
		this.roomState.combatEntities.set(entity.id, entity);
		this.runtime.set(entity.id, {
			behavior: this.createBehavior(input.behavior),
			state: {
				damage: input.damage,
				collisionRadius: input.collisionRadius,
				velocityX: input.velocityX ?? 0,
				velocityY: input.velocityY ?? 0,
				velocityZ: input.velocityZ ?? 0,
				penetration: Math.max(0, Math.trunc(input.penetration ?? 0)),
				contactIntervalS: Math.max(0, input.contactIntervalS ?? Infinity),
				terrainOffset: input.terrainOffset ?? 0,
				removeOnTerrainCollision: input.removeOnTerrainCollision ?? false,
			},
		});
		return entity;
	}

	update(dtSeconds: number): void {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		this.elapsedS += dtSeconds;
		const ids = [...this.roomState.combatEntities.keys()].sort();
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
			if (entity.targetId && !this.roomState.monsters.has(entity.targetId))
				entity.targetId = '';
			if (this.elapsedS >= entity.expiresAtS) {
				entity.phase = 'expiring';
				this.remove(id);
				continue;
			}
			const alive = runtime.behavior.update(entity, runtime.state, dtSeconds, {
				state: this.roomState,
				damage: this.damage,
				elapsedS: this.elapsedS,
				terrainHeight: this.terrainHeight,
			});
			if (!alive) this.remove(id);
		}
	}

	removeOwner(ownerSessionId: string): void {
		const ids: string[] = [];
		this.roomState.combatEntities.forEach((entity, id) => {
			if (entity.ownerSessionId === ownerSessionId) ids.push(id);
		});
		for (const id of ids.sort()) this.remove(id);
	}

	private remove(id: string): void {
		this.runtime.delete(id);
		this.roomState.combatEntities.delete(id);
	}

	private createBehavior(kind: CombatEntityBehaviorKind): CombatEntityBehavior {
		switch (kind) {
			case 'projectile':
				return new ProjectileBehavior();
			case 'persistent-zone':
				return new PersistentZoneBehavior();
			case 'temporary-attack':
				return new TemporaryAttackBehavior();
		}
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
				input.velocityX ?? 0,
				input.velocityY ?? 0,
				input.velocityZ ?? 0,
				input.contactIntervalS ?? 0,
			].every(Number.isFinite)
		);
	}
}
