import {
	COMBAT_LIMITS,
	type CombatEntity,
	type Player,
	type WeaponConfig,
	WEAPON_CONFIGS,
	type WeaponKind,
	type WeaponState,
} from '@transcendence/game-shared';
import type { CombatSystem } from '../CombatSystem';
import type { ProjectileSpawn } from '../projectiles/Projectile';

export abstract class Weapon<TConfig extends WeaponConfig = WeaponConfig> {
	protected readonly config: TConfig;
	private cooldownS: number;
	private periodS: number;

	constructor(
		readonly owner: string,
		readonly state: WeaponState,
		protected readonly combat: CombatSystem,
	) {
		this.config = WEAPON_CONFIGS[state.kind] as TConfig;
		this.periodS = 1 / this.attackRate();
		this.cooldownS = this.periodS;
	}

	update(dtSeconds: number, player: Player): void {
		if (player.life.isDepleted()) return;
		const period = 1 / this.attackRate(player);
		if (period !== this.periodS) {
			this.cooldownS = (this.cooldownS / this.periodS) * period;
			this.periodS = period;
		}
		this.cooldownS -= dtSeconds;
		const maxAttacks = COMBAT_LIMITS.maxCatchupAttacksPerTick;
		for (let attacks = 0; this.cooldownS <= 0; attacks++) {
			if (attacks === maxAttacks) {
				this.cooldownS = period;
				return;
			}
			if (!this.attack(player)) {
				this.cooldownS = 0;
				return;
			}
			this.cooldownS += period;
		}
	}

	protected abstract attack(player: Player): boolean;

	protected spawn(...spawns: ProjectileSpawn[]) {
		return this.combat.spawn(this.owner, spawns);
	}

	protected strike(hitbox: CombatEntity, damage: number, knockback: number) {
		const source = { playerId: this.owner, knockback };
		for (const id of this.combat.monstersHitBy(hitbox, hitbox))
			this.combat.damage.damageMonster(source, id, damage);
	}

	protected keepNewest(kind: WeaponKind, maximum: number): void {
		this.combat.keepNewest(this.owner, kind, maximum);
	}

	protected damage(player: Player): number {
		const { config, state } = this;
		return (
			config.baseDamage *
			(1 + state.damageBonus) *
			affinity(
				player.stats.attackDamage / 100,
				config.bonusAffinity.damage,
			)
		);
	}

	protected attackRate(player?: Player): number {
		const { config, state } = this;
		const global = player?.stats.attackSpeed ?? 1;
		return Math.min(
			COMBAT_LIMITS.maxFinalAttackRate,
			config.baseAttackRate *
				(1 + state.attackRateBonus) *
				affinity(global, config.bonusAffinity.attackRate),
		);
	}

	protected range(player: Player): number {
		const global = 1 + (player.stats.range - 8) / 8;
		return (
			(1 + this.state.rangeBonus) *
			affinity(global, this.config.bonusAffinity.range)
		);
	}

	protected size(player: Player): number {
		return (
			(1 + this.state.sizeBonus) *
			affinity(player.stats.size, this.config.bonusAffinity.size)
		);
	}

	protected duration(player: Player): number {
		return (1 + this.state.durationBonus) * player.stats.duration;
	}

	protected speed(base: number): number {
		return base * (1 + this.state.speedBonus);
	}

	protected quantity(base: number, player: Player): number {
		const total = base + this.state.quantityBonus + player.stats.quantity;
		return Math.min(
			COMBAT_LIMITS.maxProjectilesPerPlayer,
			Math.max(1, Math.trunc(total)),
		);
	}

	protected penetration(base: number, player: Player): number {
		const total =
			base + this.state.penetrationBonus + player.stats.penetration;
		return Math.max(0, Math.trunc(total));
	}
}

function affinity(value: number, weight: number): number {
	return 1 + (value - 1) * weight;
}
