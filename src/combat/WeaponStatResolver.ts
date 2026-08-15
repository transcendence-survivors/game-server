import {
	COMBAT_LIMITS,
	type Player,
	type WeaponConfig,
	type WeaponState,
} from '../../../shared-package';

export class WeaponStatResolver {
	constructor(
		private readonly config: Readonly<WeaponConfig>,
		private readonly state: WeaponState,
	) {}

	damage(player: Player): number {
		return (
			this.config.baseDamage *
			this.level().damage *
			this.globalMultiplier(
				player.stats.attackDamage / 100,
				this.config.bonusAffinity.damage,
			)
		);
	}

	attackRate(player?: Player): number {
		const global = player?.stats.attackSpeed ?? 1;
		return Math.min(
			COMBAT_LIMITS.maxFinalAttackRate,
			this.config.baseAttackRate *
				this.level().attackRate *
				this.globalMultiplier(
					global,
					this.config.bonusAffinity.attackRate,
				),
		);
	}

	rangeMultiplier(player: Player): number {
		const global = 1 + (player.stats.range - 8) / 8;
		return (
			this.level().range *
			this.globalMultiplier(global, this.config.bonusAffinity.range)
		);
	}

	sizeMultiplier(player: Player): number {
		const global = 1 + (player.stats.range - 8) / 8;
		return (
			(this.level().size ?? 1) *
			this.globalMultiplier(global, this.config.bonusAffinity.size)
		);
	}

	durationMultiplier(): number {
		return this.level().duration;
	}
	speed(base: number): number {
		return base * (this.level().speed ?? 1);
	}
	quantity(base: number): number {
		return Math.max(1, Math.trunc(base + (this.level().quantity ?? 0)));
	}
	penetration(base: number): number {
		return Math.max(0, Math.trunc(base + (this.level().penetration ?? 0)));
	}

	private globalMultiplier(value: number, affinity: number): number {
		return 1 + (value - 1) * affinity;
	}

	private level() {
		const level = Math.min(
			Math.max(1, Math.trunc(this.state.level)),
			this.config.maxLevel,
		);
		return this.config.levelScaling[level - 1];
	}
}
