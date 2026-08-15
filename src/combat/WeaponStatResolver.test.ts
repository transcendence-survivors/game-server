import { describe, expect, test } from 'bun:test';
import {
	Player,
	WeaponState,
	weaponConfigRegistry,
} from '../../../shared-package';
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
});
