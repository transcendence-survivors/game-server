import {
	MONSTER_DIRECTOR_CONFIG as CONFIG,
	TAU,
	type GameState,
	type Monster,
} from '@transcendence/game-shared';
import type { DamageResolver } from '../combat/damage/DamageResolver';
import { COOLDOWNS, type ServerMonster, type Target } from './ServerMonster';

type RequestSpawn = (kind: string, x: number, z: number) => void;

const KEEP_TARGET_RATIO = CONFIG.targetSwitchDistanceMultiplier ** 2;

export class MonsterAi {
	readonly targets: Target[] = [];
	private readonly attackers = new Map<string, number>();
	private dtSeconds = 0;
	private elapsedS = 0;

	constructor(
		private readonly roomState: GameState,
		private readonly damage: DamageResolver,
		private readonly requestSpawn: RequestSpawn,
	) {}

	beginTick(dtSeconds: number, elapsedS: number): void {
		this.dtSeconds = dtSeconds;
		this.elapsedS = elapsedS;
		this.attackers.clear();
		this.targets.length = 0;
		this.roomState.players.forEach((player, id) => {
			if (!player.life.isDepleted())
				this.targets.push({ id, x: player.x, z: player.z });
		});
	}

	update(monster: ServerMonster): boolean {
		const { cooldowns } = monster;
		for (const key of COOLDOWNS)
			cooldowns[key] = Math.max(0, cooldowns[key] - this.dtSeconds);
		monster.knockedBack = monster.knockbackRemainingS > 0;
		if (monster.knockedBack) this.advanceKnockback(monster);
		else monster.target = this.selectTarget(monster);
		if (monster.knockedBack || !monster.target) {
			this.animate(monster, 'idle');
			return false;
		}
		monster.distance = Math.hypot(
			monster.target.x - monster.x,
			monster.target.z - monster.z,
		);
		const ai = monster.definition.ai;
		if (ai.kind === 'bomber') return this.bomber(monster);
		if (ai.kind === 'charger') this.charger(monster);
		else if (ai.preferredRange === 0) {
			this.contact(monster);
			this.useSpecial(monster);
		} else if (this.keepDistance(monster) || ai.kind !== 'ranged')
			this.useSpecial(monster);
		return false;
	}

	addKnockback(
		monster: ServerMonster,
		directionX: number,
		directionZ: number,
		distance: number,
	): void {
		const speed = (distance * 2) / CONFIG.knockbackDurationS;
		monster.knockbackX += directionX * speed;
		monster.knockbackZ += directionZ * speed;
		const total = Math.hypot(monster.knockbackX, monster.knockbackZ);
		const limit = Math.min(1, CONFIG.knockbackMaximumSpeed / total);
		monster.knockbackX *= limit;
		monster.knockbackZ *= limit;
		monster.knockbackRemainingS = Math.max(
			monster.knockbackRemainingS,
			CONFIG.knockbackDurationS,
		);
	}

	private advanceKnockback(monster: ServerMonster): void {
		const remaining = monster.knockbackRemainingS;
		const step = Math.min(this.dtSeconds, remaining);
		const travel = step * (1 - (step * 0.5) / remaining);
		monster.x += monster.knockbackX * travel;
		monster.z += monster.knockbackZ * travel;
		monster.knockbackRemainingS = remaining - step;
		monster.knockbackX *= monster.knockbackRemainingS / remaining;
		monster.knockbackZ *= monster.knockbackRemainingS / remaining;
	}

	private selectTarget(monster: ServerMonster): Target | undefined {
		let nearest: Target | undefined;
		let current: Target | undefined;
		let nearestDistance = Number.POSITIVE_INFINITY;
		let currentDistance = Number.POSITIVE_INFINITY;
		for (const target of this.targets) {
			const distance =
				(target.x - monster.x) ** 2 + (target.z - monster.z) ** 2;
			if (distance < nearestDistance) {
				nearest = target;
				nearestDistance = distance;
			}
			if (target.id === monster.target?.id) {
				current = target;
				currentDistance = distance;
			}
		}
		return current && currentDistance <= nearestDistance * KEEP_TARGET_RATIO
			? current
			: nearest;
	}

	private contact(monster: ServerMonster): void {
		if (monster.distance > monster.reach) {
			this.chase(monster, monster.stats.moveSpeed, monster.reach);
			this.animate(monster, 'walk');
		} else if (this.reserveAttacker(monster)) {
			this.animate(monster, 'attack');
			this.attack(monster, 1);
		} else {
			this.face(monster);
			this.animate(monster, 'walk');
		}
	}

	private charger(monster: ServerMonster): void {
		const ai = monster.definition.ai;
		if (
			monster.cooldowns.charging <= 0 &&
			monster.cooldowns.charge <= 0 &&
			monster.distance <= CONFIG.chargeTriggerDistance
		) {
			monster.cooldowns.charging = ai.chargeDurationS;
			monster.cooldowns.charge = ai.chargeCooldownS;
		}
		if (monster.cooldowns.charging <= 0) return this.contact(monster);
		const speed = monster.stats.moveSpeed * ai.chargeSpeedMultiplier;
		this.animate(monster, 'attack');
		this.chase(monster, speed, monster.reach);
		if (
			monster.distance <= monster.reach &&
			this.reserveAttacker(monster)
		) {
			this.attack(monster, ai.chargeDamageMultiplier);
			monster.cooldowns.charging = 0;
		}
	}

	private bomber(monster: ServerMonster): boolean {
		const trigger = Math.max(
			monster.stats.attackRange + monster.state.hitboxRadius,
			monster.definition.ai.specialRadius *
				CONFIG.bomberDetonationDistanceMultiplier,
		);
		if (monster.distance > trigger) {
			this.chase(monster, monster.stats.moveSpeed, 0);
			this.animate(monster, 'walk');
			return false;
		}
		this.animate(monster, 'attack');
		this.damageArea(monster, monster.x, monster.z);
		return true;
	}

	private keepDistance(monster: ServerMonster): boolean {
		const ai = monster.definition.ai;
		const preferred = Math.max(
			ai.preferredRange,
			monster.stats.attackRange + CONFIG.preferredRangePadding,
		);
		const retreat = Math.min(
			preferred - CONFIG.preferredRangeBuffer,
			Math.max(0, ai.retreatRange),
		);
		if (monster.distance < retreat) this.flee(monster);
		else if (monster.distance > preferred)
			this.chase(monster, monster.stats.moveSpeed, preferred);
		else this.face(monster);
		const inRange =
			monster.distance >= retreat && monster.distance <= preferred;
		this.animate(monster, inRange ? 'attack' : 'walk');
		if (inRange) this.attack(monster, 1);
		return inRange;
	}

	private useSpecial(monster: ServerMonster): void {
		const ai = monster.definition.ai;
		if (ai.specialKind === 'none' || monster.cooldowns.special > 0) return;
		if (ai.specialKind === 'summon') this.summon(monster);
		else if (ai.specialKind === 'slam')
			this.damageArea(monster, monster.x, monster.z);
		else this.damageArea(monster, monster.target!.x, monster.target!.z);
		monster.cooldowns.special = ai.specialCooldownS;
		this.animate(monster, 'attack');
	}

	private summon(monster: ServerMonster): void {
		const { summonKind, summonCount } = monster.definition.ai;
		for (let index = 0; summonKind && index < summonCount; index++) {
			const angle = (index / summonCount) * TAU + this.elapsedS;
			this.requestSpawn(
				summonKind,
				monster.x + Math.cos(angle) * CONFIG.summonSpawnRadius,
				monster.z + Math.sin(angle) * CONFIG.summonSpawnRadius,
			);
		}
	}

	private attack(monster: ServerMonster, damageMultiplier: number): void {
		if (monster.cooldowns.attack > 0) return;
		const damage = monster.stats.damage * damageMultiplier;
		this.damage.damagePlayer(monster.target!.id, damage);
		monster.cooldowns.attack = monster.stats.attackCooldownS;
	}

	private damageArea(monster: ServerMonster, x: number, z: number): void {
		const ai = monster.definition.ai;
		const damage = monster.stats.damage * ai.specialDamageMultiplier;
		for (const target of this.targets)
			if (Math.hypot(target.x - x, target.z - z) <= ai.specialRadius)
				this.damage.damagePlayer(target.id, damage);
	}

	private reserveAttacker(monster: ServerMonster): boolean {
		const id = monster.target!.id;
		const count = this.attackers.get(id) ?? 0;
		const bonus = monster.isBoss ? CONFIG.bossContactAttackersBonus : 0;
		if (count >= CONFIG.maxContactAttackersPerPlayer + bonus) return false;
		this.attackers.set(id, count + 1);
		return true;
	}

	private chase(monster: ServerMonster, speed: number, stop: number): void {
		const { target, distance } = monster;
		this.face(monster);
		const step = Math.min(speed * this.dtSeconds, distance - stop);
		if (step <= 0) return;
		monster.x += ((target!.x - monster.x) / distance) * step;
		monster.z += ((target!.z - monster.z) / distance) * step;
	}

	private flee(monster: ServerMonster): void {
		const dx = monster.x - monster.target!.x;
		const dz = monster.z - monster.target!.z;
		const length = Math.hypot(dx, dz) || 1;
		const step = (monster.stats.moveSpeed * this.dtSeconds) / length;
		monster.x += dx * step;
		monster.z += dz * step;
		monster.rotationY = Math.atan2(dx, dz);
	}

	private face(monster: ServerMonster): void {
		const target = monster.target!;
		monster.rotationY = Math.atan2(
			target.x - monster.x,
			target.z - monster.z,
		);
	}

	private animate(monster: ServerMonster, animation: Monster['animState']) {
		if (monster.state.animState === animation) return;
		monster.state.animState = animation;
		monster.state.animStartedAtS = this.elapsedS;
	}
}
