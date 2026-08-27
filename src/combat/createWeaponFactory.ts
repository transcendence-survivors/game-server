import {
	weaponConfigRegistry,
	type WeaponKind,
} from '@transcendence/game-shared';
import { AuraWeapon } from './AuraWeapon';
import { AxeWeapon } from './AxeWeapon';
import { BowWeapon } from './BowWeapon';
import { StaffWeapon } from './StaffWeapon';
import { SwordWeapon } from './SwordWeapon';
import { WeaponFactory, type WeaponConstructor } from './WeaponFactory';

type WeaponConstructors = {
	[TKind in WeaponKind]: WeaponConstructor<TKind>;
};

const constructors: WeaponConstructors = {
	aura: (owner, state, config) => new AuraWeapon(owner, state, config),
	sword: (owner, state, config) => new SwordWeapon(owner, state, config),
	axe: (owner, state, config) => new AxeWeapon(owner, state, config),
	staff: (owner, state, config) => new StaffWeapon(owner, state, config),
	bow: (owner, state, config) => new BowWeapon(owner, state, config),
};

export function createWeaponFactory(): WeaponFactory {
	const factory = new WeaponFactory(weaponConfigRegistry);
	factory.register('aura', constructors.aura);
	factory.register('sword', constructors.sword);
	factory.register('axe', constructors.axe);
	factory.register('staff', constructors.staff);
	factory.register('bow', constructors.bow);
	return factory;
}
