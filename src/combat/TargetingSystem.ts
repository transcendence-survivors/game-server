import type { GameState, Monster, Player } from '@transcendence/game-shared';
import type {
	MonsterSimulationSource,
	MonsterTransform,
} from '../monsters/MonsterSimulationSource';

interface TargetMatch {
	id: string;
	monster: Monster;
	x: number;
	z: number;
	distanceSquared: number;
}

export function nearestMonster(
	state: GameState,
	player: Player,
	maximumDistance: number,
	candidateIds?: readonly string[],
	simulation?: MonsterSimulationSource,
): TargetMatch | undefined {
	if (!Number.isFinite(maximumDistance) || maximumDistance < 0)
		return undefined;
	const maximumDistanceSquared = maximumDistance * maximumDistance;
	let nearestId: string | undefined;
	let nearestMonster: Monster | undefined;
	let nearestDistanceSquared = Number.POSITIVE_INFINITY;
	let nearestX = 0;
	let nearestZ = 0;
	const transform: MonsterTransform = { x: 0, y: 0, z: 0, rotationY: 0 };
	for (const id of candidateIds ?? state.monsters.keys()) {
		const monster = state.monsters.get(id);
		if (!monster || monster.life.isDepleted()) continue;
		const exact = simulation?.readTransform(id, transform) ?? false;
		const x = exact ? transform.x : monster.x;
		const z = exact ? transform.z : monster.z;
		const dx = x - player.x;
		const dz = z - player.z;
		const distanceSquared = dx * dx + dz * dz;
		if (
			distanceSquared <= maximumDistanceSquared &&
			(distanceSquared < nearestDistanceSquared ||
				(distanceSquared === nearestDistanceSquared &&
					nearestId !== undefined &&
					id.localeCompare(nearestId) < 0))
		) {
			nearestId = id;
			nearestMonster = monster;
			nearestX = x;
			nearestZ = z;
			nearestDistanceSquared = distanceSquared;
		}
	}
	return nearestId === undefined || !nearestMonster
		? undefined
		: {
				id: nearestId,
				monster: nearestMonster,
				x: nearestX,
				z: nearestZ,
				distanceSquared: nearestDistanceSquared,
			};
}
