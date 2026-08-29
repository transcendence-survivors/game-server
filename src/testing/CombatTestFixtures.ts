import type { ClientArray } from 'colyseus';
import { GameState, Life, Monster, Player } from '@transcendence/game-shared';
import { DamageResolver } from '../combat/DamageResolver';
import { KillRewardSystem } from '../combat/KillRewardSystem';

export function createTestDamageResolver(state: GameState): DamageResolver {
	const clients = { getById: () => undefined } as unknown as ClientArray;
	return new DamageResolver(state, new KillRewardSystem(state, clients));
}

export function createCombatTestContext() {
	const state = new GameState();
	const player = new Player();
	state.players.set('player', player);
	return { state, player, damage: createTestDamageResolver(state) };
}

export function addTestMonster(
	state: GameState,
	id: string,
	x: number,
	z = 0,
	life = 100,
): Monster {
	const monster = new Monster();
	monster.x = x;
	monster.z = z;
	monster.life = new Life(life);
	state.monsters.set(id, monster);
	return monster;
}
