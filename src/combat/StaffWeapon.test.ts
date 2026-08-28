import { describe, expect, test } from 'bun:test';
import type { ClientArray } from 'colyseus';
import {
	GameState,
	Life,
	Monster,
	Player,
	WeaponState,
	weaponConfigRegistry,
} from '@transcendence/game-shared';
import { CombatEntitySystem } from './CombatEntitySystem';
import { DamageResolver } from './DamageResolver';
import { KillRewardSystem } from './KillRewardSystem';
import { StaffWeapon } from './StaffWeapon';
import { nearestMonster } from './TargetingSystem';

function setup() {
	const state = new GameState();
	const player = new Player();
	state.players.set('player', player);
	const clients = { getById: () => undefined } as unknown as ClientArray;
	const damage = new DamageResolver(
		state,
		new KillRewardSystem(state, clients),
	);
	const entities = new CombatEntitySystem(state, damage, () => 0);
	const weaponState = new WeaponState();
	weaponState.kind = 'staff';
	const weapon = new StaffWeapon(
		'player',
		weaponState,
		weaponConfigRegistry.get('staff'),
	);
	return { state, player, damage, entities, weapon, weaponState };
}

function addMonster(state: GameState, id: string, x: number, z: number) {
	const monster = new Monster();
	monster.x = x;
	monster.z = z;
	monster.life = new Life(100);
	state.monsters.set(id, monster);
	return monster;
}

function fire(result: ReturnType<typeof setup>) {
	result.weapon.update(1.55, result.player, {
		roomState: result.state,
		damage: result.damage,
		entities: result.entities,
		elapsedS: 1.55,
	});
}

describe('StaffWeapon', () => {
	test('targets the nearest living monster and breaks ties by id', () => {
		const result = setup();
		const dead = addMonster(result.state, 'dead', 1, 0);
		dead.life.current = 0;
		addMonster(result.state, 'z', 3, 4);
		addMonster(result.state, 'a', -3, 4);
		expect(nearestMonster(result.state, result.player, 5)?.id).toBe('a');
	});

	test('synchronizes its target and damages on guided impact', () => {
		const result = setup();
		const target = addMonster(result.state, 'target', 0, 6);
		fire(result);
		const fireball = [...result.state.combatEntities.values()][0];
		expect(fireball.targetId).toBe('target');
		expect(fireball.y).toBeCloseTo(1.2);
		expect(fireball.z).toBeCloseTo(0.9);
		result.entities.update(0.4);
		expect(target.life.current).toBe(76);
		expect(result.state.combatEntities.size).toBe(0);
	});

	test('launches additional fireballs from quantity upgrades', () => {
		const result = setup();
		result.weaponState.quantityBonus = 2;
		addMonster(result.state, 'target', 0, 20);
		fire(result);
		expect(result.state.combatEntities.size).toBe(3);
	});

	test('continues on its last heading when the target disappears', () => {
		const result = setup();
		addMonster(result.state, 'target', 0, 20);
		fire(result);
		const fireball = [...result.state.combatEntities.values()][0];
		result.state.monsters.delete('target');
		result.entities.update(0.1);
		expect(fireball.targetId).toBe('');
		expect(fireball.z).toBeCloseTo(2.7);
	});

	test('caps its turn rate while following a moving target', () => {
		const result = setup();
		const target = addMonster(result.state, 'target', 0, 20);
		fire(result);
		const fireball = [...result.state.combatEntities.values()][0];
		target.x = 20;
		target.z = 0;
		result.entities.update(0.1);
		const heading = Math.atan2(fireball.directionZ, fireball.directionX);
		expect(heading).toBeCloseTo(Math.PI / 2 - (240 * Math.PI) / 1800);
	});
});
