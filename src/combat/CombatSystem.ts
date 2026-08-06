import type { GameState } from '../../../shared-package';
import type { DamageResolver } from './DamageResolver';
import { PlayerLoadout } from './PlayerLoadout';
import type { WeaponFactory } from './WeaponFactory';
import type { CombatEntitySystem } from './CombatEntitySystem';

export class CombatSystem {
	private readonly loadouts = new Map<string, PlayerLoadout>();
	private elapsedS = 0;

	constructor(
		private readonly roomState: GameState,
		private readonly damage: DamageResolver,
		private readonly factory: WeaponFactory,
		private readonly entities: CombatEntitySystem,
	) {}

	update(dtSeconds: number): void {
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
		this.elapsedS += dtSeconds;
		const activePlayers = new Set<string>();
		this.roomState.players.forEach((player, sessionId) => {
			activePlayers.add(sessionId);
			let loadout = this.loadouts.get(sessionId);
			if (!loadout) {
				loadout = new PlayerLoadout(sessionId, this.factory);
				this.loadouts.set(sessionId, loadout);
			}
			loadout.synchronize(player);
			for (const weapon of loadout.all()) {
				weapon.update(dtSeconds, player, {
					roomState: this.roomState,
					damage: this.damage,
					entities: this.entities,
					elapsedS: this.elapsedS,
				});
			}
		});
		for (const sessionId of this.loadouts.keys()) {
			if (!activePlayers.has(sessionId)) this.loadouts.delete(sessionId);
		}
	}

	removePlayer(sessionId: string): void {
		this.loadouts.delete(sessionId);
	}
}
