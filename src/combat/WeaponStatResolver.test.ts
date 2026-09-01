import { describe, expect, test } from 'bun:test';
import {
	Player,
	WeaponState,
	weaponConfigRegistry,
} from '@transcendence/game-shared';
import { WeaponStatResolver } from './WeaponStatResolver';

describe('WeaponStatResolver', () => {
	test('lets weapons react differently to the same global bonus', () => {
		const player = new Player();
		player.stats.range = 16;
		const swordState = new WeaponState();
		swordState.kind = 'sword';
		const staffState = new WeaponState();
		staffState.kind = 'staff';
		const sword = new WeaponStatResolver(
			weaponConfigRegistry.get('sword'),
			swordState,
		);
		const staff = new WeaponStatResolver(
			weaponConfigRegistry.get('staff'),
			staffState,
		);
		expect(sword.rangeMultiplier(player)).toBeCloseTo(1.65);
		expect(staff.rangeMultiplier(player)).toBeCloseTo(2.25);
	});

	test('applies rolled weapon attributes without a fixed level table', () => {
		const player = new Player();
		const state = new WeaponState();
		state.kind = 'sword';
		const config = weaponConfigRegistry.get('sword');
		const resolver = new WeaponStatResolver(config, state);
		expect(resolver.damage(player)).toBeCloseTo(config.baseDamage);
		state.level = 2;
		state.damageBonus = 0.2;
		expect(resolver.damage(player)).toBeCloseTo(config.baseDamage * 1.2);
	});

	test('combines tome and weapon attributes by compatible statistic', () => {
		const player = new Player();
		player.stats.size = 1.2;
		player.stats.duration = 1.1;
		player.stats.quantity = 1;
		player.stats.penetration = 2;
		const state = new WeaponState();
		state.kind = 'bow';
		state.sizeBonus = 0.25;
		state.durationBonus = 0.5;
		state.quantityBonus = 2;
		state.penetrationBonus = 1;
		const resolver = new WeaponStatResolver(
			weaponConfigRegistry.get('bow'),
			state,
		);
		expect(resolver.sizeMultiplier(player)).toBeCloseTo(1.5);
		expect(resolver.durationMultiplier(player)).toBeCloseTo(1.65);
		expect(resolver.quantity(3, player)).toBe(6);
		expect(resolver.penetration(0, player)).toBe(3);
	});
});
