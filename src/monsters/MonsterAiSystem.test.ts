import { describe, expect, test } from 'bun:test';
import type { ClientArray } from 'colyseus';
import {
	computeArchetypeStats,
	GameState,
	getMonsterDefinition,
	getMonsterHitbox,
	Life,
	Monster,
	Player,
	World,
	type MonsterRank,
} from '@transcendence/game-shared';
import { DamageResolver } from '../combat/DamageResolver';
import { KillRewardSystem } from '../combat/KillRewardSystem';
import { MonsterAiSystem } from './MonsterAiSystem';
import type { MonsterRuntime } from './MonsterRuntime';

function createRuntime(
	kind: string,
	elapsedS = 0,
	rank: MonsterRank = 'normal',
): MonsterRuntime {
	const definition = getMonsterDefinition(kind)!;
	return {
		definition,
		stats: computeArchetypeStats(kind, elapsedS, rank, 1),
		rank,
		targetSessionId: '',
		slot: -1,
		activeIndex: -1,
		counted: false,
	};
}

function createMonster(kind: string, x: number, z = 0): Monster {
	const monster = new Monster();
	monster.kind = kind;
	monster.x = x;
	monster.z = z;
	const hitbox = getMonsterHitbox(kind, false);
	monster.hitboxRadius = hitbox.radius;
	monster.hitboxHeight = hitbox.height;
	monster.hitboxOffsetX = hitbox.offsetX;
	monster.hitboxOffsetY = hitbox.offsetY;
	monster.hitboxOffsetZ = hitbox.offsetZ;
	monster.life = new Life(100);
	return monster;
}

function createSystem() {
	const state = new GameState();
	const world = new World(1);
	const player = new Player();
	player.y = world.height(0, 0);
	state.players.set('player', player);
	const damage = new DamageResolver(
		state,
		new KillRewardSystem(state, {
			getById: () => undefined,
		} as unknown as ClientArray),
	);
	return { state, world, player, damage };
}

function createAi(
	world: World,
	state: GameState,
	damage: DamageResolver,
	runtimes: ReadonlyMap<string, MonsterRuntime>,
): MonsterAiSystem {
	return new MonsterAiSystem(world, state, damage, runtimes, () => undefined);
}

describe('MonsterAiSystem', () => {
	test('projects an impacted monster before resuming pursuit', () => {
		const { state, world, damage } = createSystem();
		const monster = createMonster('grunt', 5);
		monster.y = world.height(monster.x, monster.z);
		state.monsters.set('grunt', monster);
		const runtime = createRuntime('grunt');
		const ai = createAi(
			world,
			state,
			damage,
			new Map([['grunt', runtime]]),
		);
		ai.addKnockback('grunt', 1, 0, 3);

		ai.update(1 / 20, 1 / 20);

		expect(monster.x).toBeGreaterThan(5.8);
		const firstProjection = monster.x;
		ai.update(1 / 20, 2 / 20);
		expect(monster.x).toBeGreaterThan(firstProjection);
	});

	test('keeps exact server movement between network transform snapshots', () => {
		const { state, world, damage } = createSystem();
		const monster = createMonster('grunt', 5);
		state.monsters.set('grunt', monster);
		const runtime = createRuntime('grunt');
		const ai = createAi(
			world,
			state,
			damage,
			new Map([['grunt', runtime]]),
		);
		const publishedX = monster.x;
		const exact = { x: 0, y: 0, z: 0, rotationY: 0 };

		ai.update(1 / 60, 1 / 60);
		ai.readTransform(runtime, exact);

		expect(exact.x).toBeLessThan(publishedX);
		expect(monster.x).toBe(publishedX);
		ai.update(1 / 60, 2 / 60);
		ai.update(1 / 60, 3 / 60);
		ai.update(1 / 60, 4 / 60);
		ai.update(1 / 60, 5 / 60);
		ai.update(1 / 60, 6 / 60);
		ai.readTransform(runtime, exact);
		expect(monster.x).toBeCloseTo(exact.x, 8);
	});

	test('keeps the compact active list valid after a swapped removal', () => {
		const { state, world, damage } = createSystem();
		const removed = createMonster('grunt', 8);
		const survivor = createMonster('grunt', 6);
		const removedRuntime = createRuntime('grunt');
		const survivorRuntime = createRuntime('grunt');
		state.monsters.set('removed', removed);
		state.monsters.set('survivor', survivor);
		const ai = createAi(
			world,
			state,
			damage,
			new Map([
				['removed', removedRuntime],
				['survivor', survivorRuntime],
			]),
		);
		const exact = { x: 0, y: 0, z: 0, rotationY: 0 };

		state.monsters.delete('removed');
		ai.unregisterMonster(removedRuntime);
		ai.update(1 / 20, 1 / 20);
		ai.readTransform(survivorRuntime, exact);

		expect(survivorRuntime.activeIndex).toBe(0);
		expect(exact.x).toBeLessThan(6);
	});

	test('switches target only when another player is materially closer', () => {
		const { state, world, damage } = createSystem();
		const secondPlayer = new Player();
		secondPlayer.x = 1;
		state.players.set('second', secondPlayer);
		const monster = createMonster('grunt', 10);
		state.monsters.set('grunt', monster);
		const runtime = createRuntime('grunt');
		runtime.targetSessionId = 'player';
		const ai = createAi(
			world,
			state,
			damage,
			new Map([['grunt', runtime]]),
		);

		ai.update(1 / 20, 1 / 20);
		expect(runtime.targetSessionId).toBe('player');
		secondPlayer.x = 8;
		ai.update(1 / 20, 2 / 20);
		expect(runtime.targetSessionId).toBe('second');
	});

	test('applies data-driven contact damage when an enemy reaches a player', () => {
		const { state, world, player, damage } = createSystem();
		const monster = createMonster('grunt', 1);
		state.monsters.set('grunt', monster);
		const runtimes = new Map([['grunt', createRuntime('grunt')]]);
		const ai = createAi(world, state, damage, runtimes);

		for (let tick = 1; tick <= 6; tick++) ai.update(1 / 20, tick / 20);

		expect(player.life.current).toBeLessThan(player.life.max);
		expect(monster.animState).toBe('attack');
	});

	test('limits contact attackers so a crowd remains threatening but survivable', () => {
		const { state, world, player, damage } = createSystem();
		const runtimes = new Map<string, MonsterRuntime>();
		for (let index = 0; index < 12; index++) {
			const id = `grunt-${index}`;
			state.monsters.set(id, createMonster('grunt', 1, index * 0.01));
			runtimes.set(id, createRuntime('grunt'));
		}
		const ai = createAi(world, state, damage, runtimes);

		for (let tick = 1; tick <= 6; tick++) ai.update(1 / 20, tick / 20);

		const singleHit = 3 * (100 / 101);
		expect(player.life.current).toBeCloseTo(100 - singleHit * 8, 5);
	});
});
