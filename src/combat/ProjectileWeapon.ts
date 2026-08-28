import type { WeaponConfig, WeaponKind } from '@transcendence/game-shared';
import { Weapon, type WeaponAttackContext } from './Weapon';

export abstract class ProjectileWeapon<
	TConfig extends WeaponConfig = WeaponConfig,
> extends Weapon<TConfig> {
	protected limitEntities(
		context: WeaponAttackContext,
		kind: WeaponKind,
		maximum: number,
	): void {
		context.entities.removeOldestOwned(this.ownerSessionId, kind, maximum);
	}
}
