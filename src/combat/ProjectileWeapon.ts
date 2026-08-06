import type {
	Player,
	WeaponConfig,
	WeaponState,
} from '../../../shared-package';
import { Weapon, type WeaponAttackContext } from './Weapon';

export abstract class ProjectileWeapon<
	TConfig extends WeaponConfig = WeaponConfig,
> extends Weapon<TConfig> {
	constructor(
		ownerSessionId: string,
		state: WeaponState,
		config: Readonly<TConfig>,
	) {
		super(ownerSessionId, state, config);
	}

	protected abstract attack(
		player: Player,
		context: WeaponAttackContext,
	): boolean;
}
