import {
	type WeaponConfig,
	type WeaponKind,
	type WeaponState,
	WeaponConfigRegistry,
} from '../../../shared-package';
import type { Weapon } from './Weapon';

export type WeaponConstructor = (
	ownerSessionId: string,
	state: WeaponState,
	config: Readonly<WeaponConfig>,
) => Weapon;

export class WeaponFactory {
	private readonly constructors = new Map<WeaponKind, WeaponConstructor>();

	constructor(private readonly configs: WeaponConfigRegistry) {}

	register(kind: WeaponKind, constructor: WeaponConstructor): void {
		if (this.constructors.has(kind))
			throw new Error(`Weapon constructor already registered: ${kind}`);
		this.constructors.set(kind, constructor);
	}

	create(ownerSessionId: string, state: WeaponState): Weapon {
		const constructor = this.constructors.get(state.kind);
		if (!constructor)
			throw new Error(`Weapon constructor not registered: ${state.kind}`);
		return constructor(
			ownerSessionId,
			state,
			this.configs.get(state.kind),
		);
	}
}
