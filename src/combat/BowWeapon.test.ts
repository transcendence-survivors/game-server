import { describe, expect, test } from 'bun:test';
import type { ClientArray } from 'colyseus';
import {
	GameState,
	Life,
	Monster,
	Player,
	WeaponState,
	weaponConfigRegistry,
} from '../../../shared-package';
import { BowWeapon } from './BowWeapon';
import { CombatEntitySystem } from './CombatEntitySystem';
import { DamageResolver } from './DamageResolver';
import { KillRewardSystem } from './KillRewardSystem';

function setup() {
	const state = new GameState();
	const player = new Player();
	state.players.set('player', player);
	const clients = { getById: () => undefined } as unknown as ClientArray;
	const damage = new DamageResolver(state, new KillRewardSystem(state, clients));
	const entities = new CombatEntitySystem(state, damage, () => 0);
	const weaponState = new WeaponState();
	weaponState.kind = 'bow';
	const weapon = new BowWeapon(
		'player',
		weaponState,
		weaponConfigRegistry.get('bow'),
	);
	return { state, player, damage, entities, weapon };
}

function fire(result: ReturnType<typeof setup>, dt = 1.01) {
	result.weapon.update(dt, result.player, {
		roomState: result.state,
		damage: result.damage,
		entities: result.entities,
		elapsedS: dt,
	});
}

describe('BowWeapon', () => {
	test('creates one deterministic three-arrow volley', () => {
		const result = setup();
		result.player.rotationY = Math.PI / 2;
		fire(result);
		const arrows = [...result.state.combatEntities.values()];
		expect(arrows).toHaveLength(3);
		expect(new Set(arrows.map((arrow) => arrow.volleyId)).size).toBe(1);
		expect(arrows.map((arrow) => arrow.rotationY)).toEqual([
			Math.PI / 2 - (12 * Math.PI) / 180,
			Math.PI / 2,
			Math.PI / 2 + (12 * Math.PI) / 180,
		]);
	});

	test('keeps concurrent volleys distinct and caps active arrows', () => {
		const result = setup();
		fire(result, 5.01);
		fire(result, 1.01);
		const arrows = [...result.state.combatEntities.values()];
		expect(arrows).toHaveLength(12);
		expect(new Set(arrows.map((arrow) => arrow.volleyId)).size).toBe(4);
		expect(Math.min(...arrows.map((arrow) => arrow.spawnSequence))).toBe(4);
	});

	test('removes only the impacting arrow', () => {
		const result = setup();
		const monster = new Monster();
		monster.z = 5;
		monster.life = new Life(100);
		result.state.monsters.set('target', monster);
		fire(result);
		result.entities.update(0.2);
		expect(monster.life.current).toBe(90);
		expect(result.state.combatEntities.size).toBe(2);
	});
});
