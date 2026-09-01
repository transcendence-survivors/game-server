import {
	type WeaponConfig,
	type WeaponKind,
	type WeaponState,
	WeaponConfigRegistry,
} from '@transcendence/game-shared';
import type { Weapon } from './Weapon';

export type WeaponConstructor<TKind extends WeaponKind> = (
	ownerSessionId: string,
	state: WeaponState,
	config: Readonly<Extract<WeaponConfig, { kind: TKind }>>,
) => Weapon;

export class WeaponFactory {
	private readonly constructors = new Map<
		WeaponKind,
		(ownerSessionId: string, state: WeaponState) => Weapon
	>();

	constructor(private readonly configs: WeaponConfigRegistry) {}

	register<TKind extends WeaponKind>(
		kind: TKind,
		constructor: WeaponConstructor<TKind>,
	): void {
		if (this.constructors.has(kind))
			throw new Error(`Weapon constructor already registered: ${kind}`);
		const config = this.configs.get(kind);
		this.constructors.set(kind, (ownerSessionId, state) =>
			constructor(ownerSessionId, state, config),
		);
	}

	create(ownerSessionId: string, state: WeaponState): Weapon {
		const constructor = this.constructors.get(state.kind);
		if (!constructor)
			throw new Error(`Weapon constructor not registered: ${state.kind}`);
		return constructor(ownerSessionId, state);
	}
}
