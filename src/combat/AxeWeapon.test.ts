import { describe, expect, test } from 'bun:test';
import { WeaponState, weaponConfigRegistry } from '@transcendence/game-shared';
import {
	addTestMonster,
	createCombatTestContext,
} from '../testing/CombatTestFixtures';
import { AxeWeapon } from './AxeWeapon';
import { CombatEntitySystem } from './CombatEntitySystem';

function setup(height: (x: number, z: number) => number = () => 0) {
	const { state, player, damage } = createCombatTestContext();
	const entities = new CombatEntitySystem(state, damage, height);
	const weaponState = new WeaponState();
	weaponState.kind = 'axe';
	const weapon = new AxeWeapon(
		'player',
		weaponState,
		weaponConfigRegistry.get('axe'),
	);
	return { state, player, damage, entities, weapon };
}

function attack(setupResult: ReturnType<typeof setup>, dt = 4.01) {
	setupResult.weapon.update(dt, setupResult.player, {
		roomState: setupResult.state,
		damage: setupResult.damage,
		entities: setupResult.entities,
		elapsedS: dt,
	});
}

describe('AxeWeapon', () => {
	test('clamps a large flight step to its destination and follows terrain', () => {
		const result = setup((_x, z) => z / 2);
		addTestMonster(result.state, 'target', 0, 8);
		attack(result);
		const axe = [...result.state.combatEntities.values()][0];
		result.entities.update(1);
		expect(axe.x).toBeCloseTo(0);
		expect(axe.z).toBeCloseTo(8);
		expect(axe.y).toBeCloseTo(4.75);
		expect(axe.expiresAtS).toBeCloseTo(3 + 8 / 14);
		expect(result.state.combatTimeS).toBe(1);
	});

	test('damages a stationary target once per contact interval', () => {
		const result = setup();
		const monster = addTestMonster(result.state, 'target', 0, 8);
		attack(result);
		result.entities.update(0.6);
		result.entities.update(0.2);
		result.entities.update(0.3);
		expect(monster.life.current).toBe(76);
	});

	test('publishes a hitbox matching the displayed axe scale', () => {
		const result = setup();
		addTestMonster(result.state, 'target', 0, 8);
		attack(result);
		const axe = [...result.state.combatEntities.values()][0];
		const config = weaponConfigRegistry.get('axe');
		expect(axe.scale).toBe(1);
		expect(axe.hitboxRadius).toBeCloseTo(config.baseContactRadius);
		expect(axe.hitboxHeight).toBeCloseTo(config.baseContactHeight);
	});

	test('replaces the oldest axe when a third one is launched', () => {
		const result = setup();
		addTestMonster(result.state, 'target', 0, 8);
		attack(result, 12.01);
		expect(result.state.combatEntities.size).toBe(2);
		const sequences = [...result.state.combatEntities.values()].map(
			(entity) => entity.spawnSequence,
		);
		expect(sequences).toEqual([2, 3]);
	});

	test('aims at the nearest monster inside its maximum range', () => {
		const result = setup();
		addTestMonster(result.state, 'far', 0, 9);
		addTestMonster(result.state, 'nearest', 3, 4);
		addTestMonster(result.state, 'outside', 0, 20);
		attack(result);
		const axe = [...result.state.combatEntities.values()][0];
		expect(axe.directionX).toBeCloseTo(0.6);
		expect(axe.directionZ).toBeCloseTo(0.8);
		expect(axe.rotationY).toBeCloseTo(Math.atan2(0.6, 0.8));
		result.entities.update(1);
		expect(axe.x).toBeCloseTo(3);
		expect(axe.z).toBeCloseTo(4);
	});

	test('does not launch without a monster in range', () => {
		const result = setup();
		addTestMonster(result.state, 'outside', 0, 9);
		attack(result);
		expect(result.state.combatEntities.size).toBe(0);
		expect(result.weapon.state.activationSequence).toBe(0);
	});
});
