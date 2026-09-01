import { describe, expect, test } from 'bun:test';
import {
	GameState,
	MAX_DT,
	Player,
	PLAYER_ACCESS_RADIUS,
	World,
	type MoveInput,
} from '@transcendence/game-shared';
import { InputValidator } from './InputValidator';

const client = { sessionId: 'player' };

function validInput(seq: number): MoveInput {
	return {
		seq,
		forward: true,
		backward: false,
		right: false,
		left: false,
		jump: false,
		deltaTime: 1 / 60,
		cameraYaw: 0,
	};
}

function setup() {
	const state = new GameState();
	const world = new World(42);
	const player = new Player();
	player.y = world.height(0, 0);
	state.players.set(client.sessionId, player);
	let now = 1000;
	const validator = new InputValidator(world, state, () => now);
	return {
		player,
		validator,
		advance: (milliseconds: number) => (now += milliseconds),
	};
}

describe('InputValidator', () => {
	test('accepts a valid sequence and rejects duplicates and excessive advances', () => {
		const { player, validator, advance } = setup();
		expect(validator.validate(client, validInput(1))).toBe(true);
		expect(player.lastProcessedSeq).toBe(1);
		advance(17);
		expect(validator.validate(client, validInput(1))).toBe(false);
		expect(validator.validate(client, validInput(122))).toBe(false);
		expect(player.lastProcessedSeq).toBe(1);
	});

	test('rejects malformed, non-finite and dead-player input without mutation', () => {
		const { player, validator } = setup();
		const initial = { x: player.x, y: player.y, z: player.z };
		expect(
			validator.validate(client, { ...validInput(1), forward: 1 }),
		).toBe(false);
		expect(
			validator.validate(client, {
				...validInput(1),
				cameraYaw: Infinity,
			}),
		).toBe(false);
		expect(
			validator.validate(client, { ...validInput(1), deltaTime: NaN }),
		).toBe(false);
		player.life.takeDamage(player.life.current);
		expect(validator.validate(client, validInput(1))).toBe(false);
		expect({ x: player.x, y: player.y, z: player.z }).toEqual(initial);
	});

	test('caps movement by elapsed server time', () => {
		const { player, validator } = setup();
		const forged = { ...validInput(1), deltaTime: 10 };
		expect(validator.validate(client, forged)).toBe(true);
		const firstDistance = Math.hypot(player.x, player.z);
		expect(firstDistance).toBeLessThanOrEqual(
			player.stats.moveSpeed * MAX_DT + 0.001,
		);
		expect(validator.validate(client, { ...forged, seq: 2 })).toBe(false);
		expect(Math.hypot(player.x, player.z)).toBe(firstDistance);
	});

	test('keeps the player center inside the moving access zone', () => {
		const { player, validator } = setup();
		player.x = 0;
		player.z = PLAYER_ACCESS_RADIUS - 0.05;

		expect(validator.validate(client, validInput(1))).toBe(true);
		expect(Math.hypot(player.x, player.z)).toBeLessThanOrEqual(
			PLAYER_ACCESS_RADIUS + 0.000001,
		);
	});
});
