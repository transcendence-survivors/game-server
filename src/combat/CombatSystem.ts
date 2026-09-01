import type { GameState } from '@transcendence/game-shared';
import type { DamageResolver } from './DamageResolver';
import { PlayerLoadout } from './PlayerLoadout';
import type { WeaponFactory } from './WeaponFactory';
import type { CombatEntitySystem } from './CombatEntitySystem';
import type { WeaponAttackContext } from './Weapon';

export class CombatSystem {
	private readonly loadouts = new Map<string, PlayerLoadout>();
	private readonly attackContext: WeaponAttackContext;
	private elapsedS = 0;

	constructor(
		private readonly roomState: GameState,
		damage: DamageResolver,
		private readonly factory: WeaponFactory,
		entities: CombatEntitySystem,
	) {
		this.attackContext = {
			roomState,
			damage,
			entities,
			elapsedS: 0,
		};
	}

	update(dtSeconds: number): void {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		this.elapsedS += dtSeconds;
		this.attackContext.elapsedS = this.elapsedS;
		this.roomState.players.forEach((player, sessionId) => {
			let loadout = this.loadouts.get(sessionId);
			if (!loadout) {
				loadout = new PlayerLoadout(sessionId, this.factory);
				this.loadouts.set(sessionId, loadout);
			}
			loadout.synchronize(player);
			for (const weapon of loadout.all()) {
				weapon.update(dtSeconds, player, this.attackContext);
			}
		});
		if (this.loadouts.size === this.roomState.players.size) return;
		for (const sessionId of this.loadouts.keys()) {
			if (!this.roomState.players.has(sessionId))
				this.loadouts.delete(sessionId);
		}
	}

	removePlayer(sessionId: string): void {
		this.loadouts.delete(sessionId);
	}
}
