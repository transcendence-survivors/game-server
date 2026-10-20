import {
	MONSTER_DIRECTOR_CONFIG as CONFIG,
	PLAYER_HB_RADIUS,
	type Monster,
	type MonsterDefinition,
	type MonsterRuntimeStats,
} from '@transcendence/game-shared';

export interface Target {
	id: string;
	x: number;
	z: number;
}

export const COOLDOWNS = ['attack', 'special', 'charge', 'charging'] as const;

export class ServerMonster {
	readonly cooldowns: Record<(typeof COOLDOWNS)[number], number>;
	knockbackX = 0;
	knockbackZ = 0;
	knockbackRemainingS = 0;
	knockedBack = false;
	target?: Target;
	distance = 0;
	x: number;
	z: number;
	rotationY: number;
	readonly isBoss: boolean;
	readonly crowdRadius: number;
	readonly reach: number;

	constructor(
		readonly id: string,
		readonly serial: number,
		readonly state: Monster,
		readonly definition: MonsterDefinition,
		readonly stats: MonsterRuntimeStats,
	) {
		this.cooldowns = {
			attack: CONFIG.initialAttackCooldownS,
			special: Math.min(
				CONFIG.initialSpecialCooldownS,
				definition.ai.specialCooldownS,
			),
			charge: CONFIG.initialChargeCooldownS,
			charging: 0,
		};
		this.x = state.x;
		this.z = state.z;
		this.rotationY = state.rotationY;
		this.isBoss = state.rank === 'boss';
		this.reach = stats.attackRange + state.hitboxRadius + PLAYER_HB_RADIUS;
		this.crowdRadius =
			state.hitboxRadius * CONFIG.separationRadiusMultiplier;
	}
}
