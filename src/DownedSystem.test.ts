import { describe, expect, test } from 'bun:test';
import {
	GameState,
	PLAYER_REVIVE_RADIUS,
	Player,
	REVIVE_DURATION_S,
} from '@transcendence/game-shared';
import { DownedSystem } from './DownedSystem';

const TICK = REVIVE_DURATION_S / 4;

function addPlayer(state: GameState, sessionId: string, x = 0): Player {
	const player = new Player();
	player.x = x;
	state.players.set(sessionId, player);
	return player;
}

function setup() {
	const state = new GameState();
	const downed = addPlayer(state, 'downed');
	const ally = addPlayer(state, 'ally', 1);
	const system = new DownedSystem(state);
	return { state, system, downed, ally };
}

describe('going down', () => {
	test('a player out of life goes down instead of dying', () => {
		const { system, downed } = setup();
		downed.life.takeDamage(downed.life.max);
		system.update(TICK);
		expect(downed.isDowned).toBe(true);
		expect(downed.reviveProgress).toBe(0);
	});

	test('the aura stops being painted around a downed player', () => {
		const { system, downed } = setup();
		downed.aura.radius = 24;
		downed.life.takeDamage(downed.life.max);
		system.update(TICK);
		expect(downed.aura.radius).toBe(0);
	});

	test('a living player is left alone', () => {
		const { system, ally } = setup();
		system.update(TICK);
		expect(ally.isDowned).toBe(false);
	});
});

describe('reviving', () => {
	function downedSetup() {
		const context = setup();
		context.downed.life.takeDamage(context.downed.life.max);
		context.system.update(0);
		return context;
	}

	test('an ally holding the key nearby fills the progress', () => {
		const { system, downed } = downedSetup();
		system.setReviveIntent('ally', true);
		system.update(TICK);
		expect(downed.reviveProgress).toBeCloseTo(0.25);
		system.update(TICK);
		expect(downed.reviveProgress).toBeCloseTo(0.5);
		expect(downed.isDowned).toBe(true);
	});

	test('a full fill brings the player back at half life', () => {
		const { system, downed } = downedSetup();
		system.setReviveIntent('ally', true);
		system.update(REVIVE_DURATION_S);
		expect(downed.isDowned).toBe(false);
		expect(downed.life.current).toBe(downed.life.max / 2);
		expect(downed.reviveProgress).toBe(0);
	});

	test('nothing happens without the key held', () => {
		const { system, downed } = downedSetup();
		system.update(REVIVE_DURATION_S);
		expect(downed.isDowned).toBe(true);
		expect(downed.reviveProgress).toBe(0);
	});

	test('an ally out of range cannot revive', () => {
		const { system, downed, ally } = downedSetup();
		ally.x = PLAYER_REVIVE_RADIUS + 1;
		system.setReviveIntent('ally', true);
		system.update(REVIVE_DURATION_S);
		expect(downed.isDowned).toBe(true);
		expect(downed.reviveProgress).toBe(0);
	});

	test('releasing the key resets the progress', () => {
		const { system, downed } = downedSetup();
		system.setReviveIntent('ally', true);
		system.update(TICK);
		expect(downed.reviveProgress).toBeGreaterThan(0);
		system.setReviveIntent('ally', false);
		system.update(TICK);
		expect(downed.reviveProgress).toBe(0);
	});

	test('walking away resets the progress', () => {
		const { system, downed, ally } = downedSetup();
		system.setReviveIntent('ally', true);
		system.update(TICK);
		ally.x = PLAYER_REVIVE_RADIUS + 1;
		system.update(TICK);
		expect(downed.reviveProgress).toBe(0);
	});

	test('a reviver who goes down himself stops reviving', () => {
		const { system, downed, ally } = downedSetup();
		system.setReviveIntent('ally', true);
		system.update(TICK);
		ally.life.takeDamage(ally.life.max);
		system.update(TICK);
		expect(downed.reviveProgress).toBe(0);
		expect(ally.isDowned).toBe(true);
	});

	test('a downed player cannot revive himself', () => {
		const { system, downed } = downedSetup();
		system.setReviveIntent('downed', true);
		system.update(REVIVE_DURATION_S);
		expect(downed.isDowned).toBe(true);
	});

	test('a player who leaves stops counting as a reviver', () => {
		const { system, downed } = downedSetup();
		system.setReviveIntent('ally', true);
		system.removePlayer('ally');
		system.update(REVIVE_DURATION_S);
		expect(downed.isDowned).toBe(true);
	});
});

describe('allPlayersDowned', () => {
	test('is false while someone is still standing', () => {
		const { system, downed } = setup();
		downed.life.takeDamage(downed.life.max);
		system.update(TICK);
		expect(system.allPlayersDowned()).toBe(false);
	});

	test('is true once the whole squad is on the ground', () => {
		const { system, downed, ally } = setup();
		downed.life.takeDamage(downed.life.max);
		ally.life.takeDamage(ally.life.max);
		system.update(TICK);
		expect(system.allPlayersDowned()).toBe(true);
	});

	test('is false in an empty room', () => {
		const system = new DownedSystem(new GameState());
		expect(system.allPlayersDowned()).toBe(false);
	});
});
