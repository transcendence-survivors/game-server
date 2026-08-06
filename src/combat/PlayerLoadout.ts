import type { Player, WeaponKind } from '../../../shared-package';
import type { Weapon } from './Weapon';
import type { WeaponFactory } from './WeaponFactory';

export class PlayerLoadout {
	private readonly weapons = new Map<WeaponKind, Weapon>();

	constructor(
		readonly ownerSessionId: string,
		private readonly factory: WeaponFactory,
	) {}

	synchronize(player: Player): void {
		const activeKinds = new Set<WeaponKind>();
		player.weapons.forEach((state) => {
			activeKinds.add(state.kind);
			const current = this.weapons.get(state.kind);
			if (!current || current.state !== state)
				this.weapons.set(
					state.kind,
					this.factory.create(this.ownerSessionId, state),
				);
		});
		for (const kind of this.weapons.keys()) {
			if (!activeKinds.has(kind)) this.weapons.delete(kind);
		}
	}

	all(): readonly Weapon[] {
		return [...this.weapons.values()];
	}
}
