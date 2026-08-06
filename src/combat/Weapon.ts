import {
	COMBAT_LIMITS,
	type GameState,
	type Player,
	type WeaponConfig,
	type WeaponState,
} from '../../../shared-package';
import type { DamageResolver } from './DamageResolver';
import type { CombatEntitySystem } from './CombatEntitySystem';

export interface WeaponAttackContext {
	roomState: GameState;
	damage: DamageResolver;
	entities: CombatEntitySystem;
	elapsedS: number;
}

export abstract class Weapon<
	TConfig extends WeaponConfig = WeaponConfig,
> {
	private cooldownS: number;
	private lastPeriodS: number;

	constructor(
		readonly ownerSessionId: string,
		readonly state: WeaponState,
		readonly config: Readonly<TConfig>,
	) {
		this.lastPeriodS = this.periodS();
		this.cooldownS = this.lastPeriodS;
	}

	update(
		dtSeconds: number,
		player: Player,
		context: WeaponAttackContext,
	): void {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		if (player.life.isDepleted()) return;
		const period = this.periodS(player);
		if (!Number.isFinite(period) || period <= 0) return;
		if (period !== this.lastPeriodS) {
			this.cooldownS =
				(this.cooldownS / this.lastPeriodS) * period;
			this.lastPeriodS = period;
		}
		this.cooldownS -= dtSeconds;
		let attacks = 0;
		while (
			this.cooldownS <= 0 &&
			attacks < COMBAT_LIMITS.maxCatchupAttacksPerTick
		) {
			if (!this.attack(player, context)) {
				this.cooldownS = 0;
				return;
			}
			this.state.activationSequence++;
			this.cooldownS += period;
			attacks++;
		}
		if (
			attacks >= COMBAT_LIMITS.maxCatchupAttacksPerTick &&
			this.cooldownS <= 0
		)
			this.cooldownS = period;
	}

	protected damage(player: Player): number {
		const scaling = this.levelScaling();
		return (
			this.config.baseDamage *
			scaling.damage *
			(player.stats.attackDamage / 100)
		);
	}

	protected rangeMultiplier(): number {
		return this.levelScaling().range;
	}

	protected durationMultiplier(): number {
		return this.levelScaling().duration;
	}

	protected abstract attack(
		player: Player,
		context: WeaponAttackContext,
	): boolean;

	private periodS(player?: Player): number {
		const playerAttackRate = player?.stats.attackSpeed ?? 1;
		const attackRate = Math.min(
			COMBAT_LIMITS.maxFinalAttackRate,
			this.config.baseAttackRate *
				this.levelScaling().attackRate *
				playerAttackRate,
		);
		return 1 / attackRate;
	}

	private levelScaling() {
		const level = Math.min(
			Math.max(1, Math.trunc(this.state.level)),
			this.config.maxLevel,
		);
		return this.config.levelScaling[level - 1];
	}
}
