import {
	WEAPON_KINDS,
	weaponConfigRegistry,
	type AuraWeaponConfig,
	type AxeWeaponConfig,
	type BowWeaponConfig,
	type StaffWeaponConfig,
	type SwordWeaponConfig,
	type WeaponKind,
} from '../../../shared-package';
import { AuraWeapon } from './AuraWeapon';
import { AxeWeapon } from './AxeWeapon';
import { BowWeapon } from './BowWeapon';
import { StaffWeapon } from './StaffWeapon';
import { SwordWeapon } from './SwordWeapon';
import { WeaponFactory, type WeaponConstructor } from './WeaponFactory';

const constructors: Record<WeaponKind, WeaponConstructor> = {
	aura: (owner, state, config) =>
		new AuraWeapon(owner, state, config as Readonly<AuraWeaponConfig>),
	sword: (owner, state, config) =>
		new SwordWeapon(owner, state, config as Readonly<SwordWeaponConfig>),
	axe: (owner, state, config) =>
		new AxeWeapon(owner, state, config as Readonly<AxeWeaponConfig>),
	staff: (owner, state, config) =>
		new StaffWeapon(owner, state, config as Readonly<StaffWeaponConfig>),
	bow: (owner, state, config) =>
		new BowWeapon(owner, state, config as Readonly<BowWeaponConfig>),
};

export function createWeaponFactory(): WeaponFactory {
	const factory = new WeaponFactory(weaponConfigRegistry);
	for (const kind of WEAPON_KINDS) factory.register(kind, constructors[kind]);
	return factory;
}
