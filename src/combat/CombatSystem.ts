import {
	COMBAT_LIMITS,
	type CombatEntity,
	type GameState,
	type Monster,
	type Vec3d,
	type WeaponKind,
	type WeaponState,
} from '@transcendence/game-shared';
import type { MonsterDirector } from '../monsters/MonsterDirector';
import type { DamageResolver } from './damage/DamageResolver';
import { MonsterHits } from './hits/MonsterHits';
import { Projectile, type ProjectileSpawn } from './projectiles/Projectile';
import { AuraWeapon } from './weapons/AuraWeapon';
import { AxeWeapon } from './weapons/AxeWeapon';
import { BowWeapon } from './weapons/BowWeapon';
import { StaffWeapon } from './weapons/StaffWeapon';
import { SwordWeapon } from './weapons/SwordWeapon';
import type { Weapon } from './weapons/Weapon';

const WEAPONS = {
	aura: AuraWeapon,
	sword: SwordWeapon,
	axe: AxeWeapon,
	staff: StaffWeapon,
	bow: BowWeapon,
};

export class CombatSystem {
	readonly hits: MonsterHits;
	nowS = 0;
	private readonly weapons = new WeakMap<WeaponState, Weapon>();
	private readonly projectiles = new Map<string, Projectile>();
	private readonly candidates: string[] = [];
	private nextSequence = 1;

	constructor(
		private readonly roomState: GameState,
		readonly damage: DamageResolver,
		readonly terrainHeight: (x: number, z: number) => number,
		monsters: Pick<MonsterDirector, 'queryBox'>,
	) {
		this.hits = new MonsterHits(roomState, monsters);
	}

	update(dtSeconds: number): void {
		this.nowS += dtSeconds;
		this.roomState.players.forEach((player, owner) =>
			player.weapons.forEach((state) =>
				this.weapon(owner, state).update(dtSeconds, player),
			),
		);
		this.roomState.combatTimeS = this.nowS;
		for (const [id, projectile] of this.projectiles) {
			const { entity } = projectile;
			if (
				!this.roomState.players.has(entity.ownerSessionId) ||
				this.nowS >= entity.expiresAtS ||
				!projectile.update(dtSeconds, this)
			)
				this.remove(id);
		}
	}

	spawn(owner: string, spawns: readonly ProjectileSpawn[]): CombatEntity[] {
		const owned = [...this.projectiles.values()].filter(
			({ entity }) => entity.ownerSessionId === owner,
		).length;
		if (
			this.projectiles.size + spawns.length >
				COMBAT_LIMITS.maxCombatEntitiesPerRoom ||
			owned + spawns.length > COMBAT_LIMITS.maxProjectilesPerPlayer
		)
			return [];
		return spawns.map((spawn) => {
			const id = `${owner}:${this.nextSequence++}`;
			const projectile = new Projectile(id, owner, spawn, this.nowS);
			this.projectiles.set(id, projectile);
			this.roomState.combatEntities.set(id, projectile.entity);
			return projectile.entity;
		});
	}

	keepNewest(owner: string, kind: WeaponKind, maximum: number): void {
		const owned = [...this.projectiles.values()].filter(
			({ entity }) =>
				entity.ownerSessionId === owner && entity.weaponKind === kind,
		);
		for (const { entity } of owned.slice(
			0,
			Math.max(0, owned.length - maximum),
		))
			this.remove(entity.id);
	}

	removePlayer(owner: string): void {
		this.roomState.players
			.get(owner)
			?.weapons.forEach((state) => this.weapons.delete(state));
		for (const [id, { entity }] of this.projectiles)
			if (entity.ownerSessionId === owner) this.remove(id);
	}

	monstersHitBy(start: Vec3d, hitbox: CombatEntity): string[] {
		return this.hits.hitBy(start, hitbox, this.nowS, this.candidates);
	}

	monster(id: string): Monster | undefined {
		return this.roomState.monsters.get(id);
	}

	private weapon(owner: string, state: WeaponState): Weapon {
		let weapon = this.weapons.get(state);
		if (weapon?.owner !== owner) {
			weapon = new WEAPONS[state.kind](owner, state, this);
			this.weapons.set(state, weapon);
		}
		return weapon;
	}

	private remove(id: string): void {
		this.projectiles.delete(id);
		this.roomState.combatEntities.delete(id);
	}
}
