import {
	COMBAT_LIMITS,
	type Player,
	type WeaponConfig,
	type WeaponState,
} from '@transcendence/game-shared';

export class WeaponStatResolver {
	constructor(
		private readonly config: Readonly<WeaponConfig>,
		private readonly state: WeaponState,
	) {}

	damage(player: Player): number {
		return (
			this.config.baseDamage *
			(1 + this.state.damageBonus) *
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
				(1 + this.state.attackRateBonus) *
				this.globalMultiplier(
					global,
					this.config.bonusAffinity.attackRate,
				),
		);
	}

	rangeMultiplier(player: Player): number {
		const global = 1 + (player.stats.range - 8) / 8;
		return (
			(1 + this.state.rangeBonus) *
			this.globalMultiplier(global, this.config.bonusAffinity.range)
		);
	}

	sizeMultiplier(player: Player): number {
		return (
			(1 + this.state.sizeBonus) *
			this.globalMultiplier(
				player.stats.size,
				this.config.bonusAffinity.size,
			)
		);
	}

	durationMultiplier(player: Player): number {
		return (1 + this.state.durationBonus) * player.stats.duration;
	}

	knockbackMultiplier(): number {
		return 1 + this.state.knockbackBonus;
	}

	speed(base: number): number {
		return base * (1 + this.state.speedBonus);
	}

	quantity(base: number, player: Player): number {
		return Math.min(
			COMBAT_LIMITS.maxProjectilesPerPlayer,
			Math.max(
				1,
				Math.trunc(
					base + this.state.quantityBonus + player.stats.quantity,
				),
			),
		);
	}

	penetration(base: number, player: Player): number {
		return Math.max(
			0,
			Math.trunc(
				base + this.state.penetrationBonus + player.stats.penetration,
			),
		);
	}

	private globalMultiplier(value: number, affinity: number): number {
		return 1 + (value - 1) * affinity;
	}
}
