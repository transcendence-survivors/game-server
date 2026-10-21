import {
	COMBAT_LIMITS,
	type GameState,
	type Monster,
	type MonsterDamageEvent,
	MONSTER_DIRECTOR_CONFIG,
	type Player,
} from '@transcendence/game-shared';

export interface DamageSource {
	playerId: string;
	knockback: number;
}

export class DamageResolver {
	onKnockback = (
		_id: string,
		_x: number,
		_z: number,
		_distance: number,
	) => {};
	onMonsterDeath = (_id: string) => {};
	private impactEvents: MonsterDamageEvent[] = [];

	constructor(
		private readonly roomState: GameState,
		private readonly onLevelsGained: (
			playerId: string,
			levels: number,
		) => void,
	) {}

	damagePlayer(playerId: string, amount: number): void {
		const player = this.roomState.players.get(playerId);
		if (!player || player.life.isDepleted()) return;
		player.life.takeDamage(amount * (100 / (100 + player.stats.armor)));
	}

	damageMonster(source: DamageSource, monsterId: string, amount: number) {
		const player = this.roomState.players.get(source.playerId);
		const monster = this.roomState.monsters.get(monsterId);
		if (!player || !monster) return 0;
		const applied = Math.min(amount, monster.life.current);
		monster.life.takeDamage(applied);
		if (!player.isDowned && !player.life.isDepleted())
			player.life.heal(applied * (player.stats.lifesteal / 100));
		const fatal = monster.life.isDepleted();
		if (this.impactEvents.length < COMBAT_LIMITS.maxImpactEventsPerTick)
			this.impactEvents.push({
				id: monsterId,
				x: monster.x,
				y: monster.y,
				z: monster.z,
				amount: applied,
				fatal,
			});
		if (!fatal) this.knockBack(source, player, monsterId, monster);
		else {
			this.reward(source.playerId, player, monster);
			this.onMonsterDeath(monsterId);
			this.roomState.monsters.delete(monsterId);
		}
		return applied;
	}

	drainImpactEvents(): MonsterDamageEvent[] {
		const events = this.impactEvents;
		this.impactEvents = [];
		return events;
	}

	private reward(playerId: string, player: Player, monster: Monster): void {
		const previousLevel = player.experience.level;
		player.experience.gain(monster.xpReward);
		const levels = player.experience.level - previousLevel;
		if (levels > 0) this.onLevelsGained(playerId, levels);
		player.stats.killAmount++;
		this.roomState.totalKills++;
	}

	private knockBack(
		source: DamageSource,
		player: Player,
		monsterId: string,
		monster: Monster,
	): void {
		const force =
			source.knockback *
			Math.pow(
				1 - monster.knockbackResistance,
				MONSTER_DIRECTOR_CONFIG.knockbackResistanceExponent,
			);
		let directionX = monster.x - player.x;
		let directionZ = monster.z - player.z;
		let length = Math.hypot(directionX, directionZ);
		if (length <= Number.EPSILON) {
			directionX = Math.sin(player.rotationY);
			directionZ = Math.cos(player.rotationY);
			length = 1;
		}
		this.onKnockback(
			monsterId,
			directionX / length,
			directionZ / length,
			force,
		);
	}
}
