import type { GameState, Monster, Player } from '../../../shared-package';

export interface TargetMatch {
	id: string;
	monster: Monster;
	distanceSquared: number;
}

export class TargetingSystem {
	constructor(private readonly state: GameState) {}

	nearestMonster(player: Player, maximumDistance: number): TargetMatch | undefined {
		if (!Number.isFinite(maximumDistance) || maximumDistance < 0) return undefined;
		const maximumDistanceSquared = maximumDistance * maximumDistance;
		const matches: TargetMatch[] = [];
		this.state.monsters.forEach((monster, id) => {
			if (monster.life.isDepleted()) return;
			const dx = monster.x - player.x;
			const dz = monster.z - player.z;
			const distanceSquared = dx * dx + dz * dz;
			if (distanceSquared <= maximumDistanceSquared)
				matches.push({ id, monster, distanceSquared });
		});
		return matches.sort(
			(left, right) =>
				left.distanceSquared - right.distanceSquared ||
				left.id.localeCompare(right.id),
		)[0];
	}
}
