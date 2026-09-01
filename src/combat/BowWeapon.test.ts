import { describe, expect, test } from 'bun:test';
import { WeaponState, weaponConfigRegistry } from '@transcendence/game-shared';
import {
	addTestMonster,
	createCombatTestContext,
} from '../testing/CombatTestFixtures';
import { BowWeapon } from './BowWeapon';
import { CombatEntitySystem } from './CombatEntitySystem';

function setup() {
	const { state, player, damage } = createCombatTestContext();
	const entities = new CombatEntitySystem(state, damage, () => 0);
	const weaponState = new WeaponState();
	weaponState.kind = 'bow';
	const weapon = new BowWeapon(
		'player',
		weaponState,
		weaponConfigRegistry.get('bow'),
	);
	return { state, player, damage, entities, weapon, weaponState };
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
		const expectedAngles = [
			Math.PI / 2 - (45 * Math.PI) / 180,
			Math.PI / 2,
			Math.PI / 2 + (45 * Math.PI) / 180,
		];
		arrows.forEach((arrow, index) =>
			expect(arrow.rotationY).toBeCloseTo(expectedAngles[index]!),
		);
	});

	test('uses rolled and global quantity bonuses in the volley', () => {
		const result = setup();
		result.weaponState.quantityBonus = 1;
		result.player.stats.quantity = 1;
		fire(result);
		expect(result.state.combatEntities.size).toBe(5);
	});

	test('caps concurrent arrows by removing the oldest volley', () => {
		const result = setup();
		fire(result, 5.01);
		fire(result, 1.01);
		const arrows = [...result.state.combatEntities.values()];
		expect(arrows).toHaveLength(12);
		expect(Math.min(...arrows.map((arrow) => arrow.spawnSequence))).toBe(4);
	});

	test('removes only the impacting arrow', () => {
		const result = setup();
		const monster = addTestMonster(result.state, 'target', 0, 5);
		fire(result);
		result.entities.update(0.2);
		expect(monster.life.current).toBe(90);
		expect(result.state.combatEntities.size).toBe(2);
	});
});
