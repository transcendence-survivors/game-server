import type { Player, WeaponKind } from '@transcendence/game-shared';
import type { Weapon } from './Weapon';
import type { WeaponFactory } from './WeaponFactory';

export class PlayerLoadout {
	private readonly weapons = new Map<WeaponKind, Weapon>();

	constructor(
		readonly ownerSessionId: string,
		private readonly factory: WeaponFactory,
	) {}

	synchronize(player: Player): void {
		player.weapons.forEach((state) => {
			const current = this.weapons.get(state.kind);
			if (!current || current.state !== state)
				this.weapons.set(
					state.kind,
					this.factory.create(this.ownerSessionId, state),
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
