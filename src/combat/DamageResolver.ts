import {
	COMBAT_LIMITS,
	type CombatImpactEvent,
	type GameState,
	MONSTER_DIRECTOR_CONFIG,
	type WeaponKind,
} from '@transcendence/game-shared';
import { KillRewardSystem } from './KillRewardSystem';
import type {
	MonsterSimulationSource,
	MonsterTransform,
} from '../monsters/MonsterSimulationSource';

export interface DamageSource {
	playerId: string;
	weaponKind: WeaponKind;
	combatEntityId: string;
	knockback?: number;
}

export interface DamageResult {
	requested: number;
	applied: number;
	fatal: boolean;
}

const NO_DAMAGE: Readonly<DamageResult> = Object.freeze({
	requested: 0,
	applied: 0,
	fatal: false,
});

const KNOCKBACK_BY_WEAPON: Readonly<Record<WeaponKind, number>> = {
	aura: 1,
	sword: 4,
	axe: 3.5,
	staff: 2.6,
	bow: 2,
};

export type MonsterKnockbackHandler = (
	monsterId: string,
	directionX: number,
	directionZ: number,
	projectionDistance: number,
) => void;

export type MonsterDeathHandler = (monsterId: string) => void;

export class DamageResolver {
	private impactEvents: CombatImpactEvent[] = [];
	private knockbackHandler?: MonsterKnockbackHandler;
	private monsterDeathHandler?: MonsterDeathHandler;
	private monsterSimulation?: MonsterSimulationSource;
	private readonly monsterTransform: MonsterTransform = {
		x: 0,
		y: 0,
		z: 0,
		rotationY: 0,
	};

	constructor(
		private readonly roomState: GameState,
		private readonly rewards: KillRewardSystem,
	) {}

	setKnockbackHandler(handler: MonsterKnockbackHandler): void {
		this.knockbackHandler = handler;
	}

	setMonsterDeathHandler(handler: MonsterDeathHandler): void {
		this.monsterDeathHandler = handler;
	}

	setMonsterSimulation(source: MonsterSimulationSource): void {
		this.monsterSimulation = source;
	}

	damagePlayer(playerId: string, amount: number): DamageResult {
		const player = this.roomState.players.get(playerId);
		if (!player || player.life.isDepleted()) return NO_DAMAGE;
		if (player.debugImmortal) return NO_DAMAGE;
		if (!Number.isFinite(amount) || amount <= 0) return NO_DAMAGE;
		const armor = Math.max(0, player.stats.armor);
		const requested = amount * (100 / (100 + armor));
		const applied = Math.min(requested, player.life.current);
		player.life.takeDamage(applied);
		return { requested, applied, fatal: player.life.isDepleted() };
	}

	damageMonster(
		source: DamageSource,
		monsterId: string,
		amount: number,
	): DamageResult {
		if (!Number.isFinite(amount) || amount <= 0) return NO_DAMAGE;
		if (!this.roomState.players.has(source.playerId)) return NO_DAMAGE;
		const monster = this.roomState.monsters.get(monsterId);
		if (!monster || monster.life.isDepleted()) return NO_DAMAGE;
		const applied = Math.min(amount, monster.life.current);
		monster.life.takeDamage(applied);
		this.rewards.healFromDamage(source.playerId, applied);
		const fatal = monster.life.isDepleted();
		const publishImpact =
			this.impactEvents.length < COMBAT_LIMITS.maxImpactEventsPerTick;
		const position = this.monsterTransform;
		if (
			(fatal && !publishImpact) ||
			!this.monsterSimulation?.readTransform(monsterId, position)
		) {
			position.x = monster.x;
			position.y = monster.y;
			position.z = monster.z;
		}
		if (publishImpact) {
			this.impactEvents.push({
				id: monsterId,
				x: position.x,
				y: position.y,
				z: position.z,
				amount: applied,
				isBoss: monster.isBoss,
				isElite: monster.isElite,
				fatal,
				sourcePlayerId: source.playerId,
				weaponKind: source.weaponKind,
				combatEntityId: source.combatEntityId,
			});
		}
		if (fatal) {
			this.rewards.reward(source.playerId, monster);
			this.monsterDeathHandler?.(monsterId);
			this.roomState.monsters.delete(monsterId);
		} else {
			this.applyKnockback(source, monsterId, monster, position);
		}
		return { requested: amount, applied, fatal };
	}

	private applyKnockback(
		source: DamageSource,
		monsterId: string,
		monster: { x: number; z: number; knockbackResistance?: number },
		position: MonsterTransform,
	): void {
		const player = this.roomState.players.get(source.playerId);
		if (!player) return;
		const force =
			source.knockback ?? KNOCKBACK_BY_WEAPON[source.weaponKind];
		const resistanceValue = monster.knockbackResistance;
		const safeResistance =
			typeof resistanceValue === 'number' &&
			Number.isFinite(resistanceValue)
				? resistanceValue
				: 0;
		const resistance = Math.min(1, Math.max(0, safeResistance));
		const effectiveForce =
			force *
			Math.pow(
				1 - resistance,
				MONSTER_DIRECTOR_CONFIG.knockbackResistanceExponent,
			);
		if (!Number.isFinite(effectiveForce) || effectiveForce <= 0) return;
		let directionX = position.x - player.x;
		let directionZ = position.z - player.z;
		let length = Math.hypot(directionX, directionZ);
		if (!Number.isFinite(length) || length <= Number.EPSILON) {
			directionX = Math.sin(player.rotationY);
			directionZ = Math.cos(player.rotationY);
			length = 1;
		}
		directionX /= length;
		directionZ /= length;
		if (this.knockbackHandler) {
			this.knockbackHandler(
				monsterId,
				directionX,
				directionZ,
				effectiveForce,
			);
			return;
		}
		// Standalone combat tests and tools may not own a MonsterManager.
		monster.x += directionX * effectiveForce;
		monster.z += directionZ * effectiveForce;
	}

	drainImpactEvents(): CombatImpactEvent[] {
		if (this.impactEvents.length === 0) return [];
		const events = this.impactEvents;
		this.impactEvents = [];
		return events;
	}
}
