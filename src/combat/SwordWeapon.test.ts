import { describe, expect, test } from 'bun:test';
import {
	Player,
	WeaponState,
	weaponConfigRegistry,
} from '@transcendence/game-shared';
import {
	addTestMonster,
	createCombatTestContext,
} from '../testing/CombatTestFixtures';
import { CombatEntitySystem } from './CombatEntitySystem';
import { SwordWeapon } from './SwordWeapon';

function setup(rotationY = 0) {
	const { state, player, damage } = createCombatTestContext();
	player.rotationY = rotationY;
	const entities = new CombatEntitySystem(state, damage, () => 0);
	const weaponState = new WeaponState();
	weaponState.kind = 'sword';
	const weapon = new SwordWeapon(
		'player',
		weaponState,
		weaponConfigRegistry.get('sword'),
	);
	return { state, player, damage, entities, weapon };
}

describe('SwordWeapon', () => {
	test('hits front and sector edge once but never hits behind', () => {
		const { state, player, damage, entities, weapon } = setup();
		const front = addTestMonster(state, 'front', 0, 3);
		const edgeAngle = (50 * Math.PI) / 180;
		const edge = addTestMonster(
			state,
			'edge',
			Math.sin(edgeAngle) * 4,
			Math.cos(edgeAngle) * 4,
		);
		const behind = addTestMonster(state, 'behind', 0, -2);
		weapon.update(0.8, player, {
			roomState: state,
			damage,
			entities,
			elapsedS: 0.8,
		});
		expect(front.life.current).toBe(82);
		expect(edge.life.current).toBe(82);
		expect(behind.life.current).toBe(100);
		expect(front.x).toBeCloseTo(0);
		expect(front.z).toBeCloseTo(7);
		expect(Math.hypot(edge.x, edge.z)).toBeCloseTo(8);
		expect(behind.z).toBe(-2);
		expect(state.combatEntities.size).toBe(1);
		expect(damage.drainImpactEvents()).toHaveLength(2);
	});

	test('uses captured rotations for simultaneous player attacks', () => {
		const first = setup(Math.PI / 2);
		const secondPlayer = new Player();
		secondPlayer.x = 20;
		secondPlayer.rotationY = -Math.PI / 2;
		first.state.players.set('second', secondPlayer);
		const secondState = new WeaponState();
		secondState.kind = 'sword';
		const secondWeapon = new SwordWeapon(
			'second',
			secondState,
			weaponConfigRegistry.get('sword'),
		);
		const firstTarget = addTestMonster(first.state, 'first-target', 3, 0);
		const secondTarget = addTestMonster(
			first.state,
			'second-target',
			17,
			0,
		);
		const context = {
			roomState: first.state,
			damage: first.damage,
			entities: first.entities,
			elapsedS: 0.8,
		};
		first.weapon.update(0.8, first.player, {
			...context,
		});
		secondWeapon.update(0.8, secondPlayer, context);
		const slashes = [...first.state.combatEntities.values()];
		expect(firstTarget.life.current).toBe(82);
		expect(secondTarget.life.current).toBe(82);
		expect(slashes).toHaveLength(2);
		expect(slashes[0].rotationY).toBe(Math.PI / 2);
		expect(slashes[0].directionX).toBeCloseTo(1);
		expect(slashes[1].rotationY).toBe(-Math.PI / 2);
		expect(slashes[1].directionX).toBeCloseTo(-1);
	});
});
