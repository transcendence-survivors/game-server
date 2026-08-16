import {
	COMBAT_LIMITS,
	type CombatImpactEvent,
	type GameState,
	type WeaponKind,
} from '../../../shared-package';
import { KillRewardSystem } from './KillRewardSystem';

export interface DamageSource {
	playerId: string;
	weaponKind: WeaponKind;
	combatEntityId: string;
	directionX?: number;
	directionZ?: number;
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
	aura: 0.65,
	sword: 3,
	axe: 2.4,
	staff: 1.6,
	bow: 1.1,
};

export class DamageResolver {
	private impactEvents: CombatImpactEvent[] = [];

	constructor(
		private readonly roomState: GameState,
		private readonly rewards: KillRewardSystem,
	) {}

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
		const fatal = monster.life.isDepleted();
		if (this.impactEvents.length < COMBAT_LIMITS.maxImpactEventsPerTick) {
			this.impactEvents.push({
				id: monsterId,
				x: monster.x,
				y: monster.y,
				z: monster.z,
				amount: applied,
				isBoss: monster.isBoss,
				fatal,
				sourcePlayerId: source.playerId,
				weaponKind: source.weaponKind,
				combatEntityId: source.combatEntityId,
			});
		}
		if (fatal) {
			this.rewards.reward(source.playerId, monster, applied);
			this.roomState.monsters.delete(monsterId);
		} else {
			this.applyKnockback(source, monster);
		}
		return { requested: amount, applied, fatal };
	}

	private applyKnockback(
		source: DamageSource,
		monster: { x: number; z: number },
	): void {
		const player = this.roomState.players.get(source.playerId);
		if (!player) return;
		const force =
			source.knockback ?? KNOCKBACK_BY_WEAPON[source.weaponKind];
		if (!Number.isFinite(force) || force <= 0) return;
		let directionX = source.directionX ?? monster.x - player.x;
		let directionZ = source.directionZ ?? monster.z - player.z;
		let length = Math.hypot(directionX, directionZ);
		if (!Number.isFinite(length) || length <= Number.EPSILON) {
			directionX = Math.sin(player.rotationY);
			directionZ = Math.cos(player.rotationY);
			length = 1;
		}
		monster.x += (directionX / length) * force;
		monster.z += (directionZ / length) * force;
	}

	drainImpactEvents(): CombatImpactEvent[] {
		if (this.impactEvents.length === 0) return [];
		const events = this.impactEvents;
		this.impactEvents = [];
		return events;
	}
}
