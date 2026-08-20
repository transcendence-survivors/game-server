import type {
	MonsterDefinition,
	MonsterRank,
	MonsterRuntimeStats,
} from '@transcendence/game-shared';

export interface MonsterRuntime {
	definition: MonsterDefinition;
	stats: MonsterRuntimeStats;
	rank: MonsterRank;
	targetSessionId: string;
	slot: number;
	activeIndex: number;
	counted: boolean;
}
