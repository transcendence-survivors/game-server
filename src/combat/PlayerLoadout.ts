import {
	weaponConfigRegistry,
	type Player,
	type WeaponConfig,
	type WeaponKind,
	type WeaponState,
} from '@transcendence/game-shared';
import type { Weapon } from './Weapon';
import { AuraWeapon } from './AuraWeapon';
import { AxeWeapon } from './AxeWeapon';
import { BowWeapon } from './BowWeapon';
import { StaffWeapon } from './StaffWeapon';
import { SwordWeapon } from './SwordWeapon';

type WeaponConstructors = {
	[TKind in WeaponKind]: new (
		ownerSessionId: string,
		state: WeaponState,
		config: Readonly<Extract<WeaponConfig, { kind: TKind }>>,
	) => Weapon;
};

const WEAPONS: WeaponConstructors = {
	aura: AuraWeapon,
	sword: SwordWeapon,
	axe: AxeWeapon,
	staff: StaffWeapon,
	bow: BowWeapon,
};

function createWeapon<TKind extends WeaponKind>(
	kind: TKind,
	ownerSessionId: string,
	state: WeaponState,
): Weapon {
	const WeaponClass: WeaponConstructors[TKind] = WEAPONS[kind];
	return new WeaponClass(
		ownerSessionId,
		state,
		weaponConfigRegistry.get(kind),
	);
}

export class PlayerLoadout {
	private readonly weapons = new Map<WeaponKind, Weapon>();

	constructor(readonly ownerSessionId: string) {}

	synchronize(player: Player): void {
		player.weapons.forEach((state) => {
			const current = this.weapons.get(state.kind);
			if (!current || current.state !== state)
				this.weapons.set(
					state.kind,
					createWeapon(state.kind, this.ownerSessionId, state),
				);
		});
		for (const kind of this.weapons.keys()) {
			if (!player.weapons.has(kind)) this.weapons.delete(kind);
		}
	}

	all(): IterableIterator<Weapon> {
		return this.weapons.values();
	}
}
