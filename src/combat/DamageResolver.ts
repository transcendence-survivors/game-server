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

export class DamageResolver {
	private impactEvents: CombatImpactEvent[] = [];

	constructor(
		private readonly roomState: GameState,
		private readonly rewards: KillRewardSystem,
	) {}

	damagePlayer(playerId: string, amount: number): DamageResult {
		const player = this.roomState.players.get(playerId);
		if (!player || player.life.isDepleted()) return NO_DAMAGE;
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
		}
		return { requested: amount, applied, fatal };
	}

	drainImpactEvents(): CombatImpactEvent[] {
		if (this.impactEvents.length === 0) return [];
		const events = this.impactEvents;
		this.impactEvents = [];
		return events;
	}
}
