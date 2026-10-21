import {
	type CombatEntity,
	doesHitboxHitMonsterPart,
	type GameState,
	type Monster,
	monsterHitboxPrimitives,
	type MonsterHitboxPrimitive,
	type MonsterWorldHitbox,
	type Player,
	type Vec3d,
} from '@transcendence/game-shared';
import type { MonsterDirector } from '../../monsters/MonsterDirector';

export interface NearestMonster {
	id: string;
	monster: Monster;
	distanceSquared: number;
}

interface HitboxCache {
	timeS: number;
	world: MonsterWorldHitbox[];
	posed: MonsterHitboxPrimitive[];
}

export class MonsterHits {
	private readonly hitboxes = new WeakMap<Monster, HitboxCache>();

	constructor(
		private readonly roomState: GameState,
		private readonly monsters: Pick<MonsterDirector, 'queryBox'>,
	) {}

	nearest(
		player: Player,
		maximumDistance: number,
		candidates: string[],
	): NearestMonster | undefined {
		const { x, z } = player;
		const reach = maximumDistance;
		let nearest: NearestMonster | undefined;
		this.monsters.queryBox(
			x - reach,
			x + reach,
			z - reach,
			z + reach,
			candidates,
		);
		for (const id of candidates) {
			const monster = this.roomState.monsters.get(id)!;
			const dx = monster.x - x;
			const dz = monster.z - z;
			const distanceSquared = dx * dx + dz * dz;
			if (
				distanceSquared <= reach * reach &&
				(!nearest ||
					distanceSquared < nearest.distanceSquared ||
					(distanceSquared === nearest.distanceSquared &&
						id.localeCompare(nearest.id) < 0))
			)
				nearest = { id, monster, distanceSquared };
		}
		return nearest;
	}

	hitBy(
		start: Vec3d,
		hitbox: CombatEntity,
		timeS: number,
		result: string[],
	): string[] {
		const reach =
			hitbox.hitboxShape === 'box'
				? Math.hypot(hitbox.hitboxWidth, hitbox.hitboxDepth) / 2
				: hitbox.hitboxRadius;
		this.monsters.queryBox(
			Math.min(start.x, hitbox.x) - reach,
			Math.max(start.x, hitbox.x) + reach,
			Math.min(start.z, hitbox.z) - reach,
			Math.max(start.z, hitbox.z) + reach,
			result,
		);
		let count = 0;
		for (const id of result)
			if (this.touches(start, hitbox, id, timeS)) result[count++] = id;
		result.length = count;
		return result;
	}

	private touches(
		start: Vec3d,
		hitbox: CombatEntity,
		id: string,
		timeS: number,
	) {
		const monster = this.roomState.monsters.get(id)!;
		const cache = this.hitboxes.get(monster) ?? {
			timeS: NaN,
			world: [],
			posed: [],
		};
		if (cache.timeS !== timeS) {
			cache.timeS = timeS;
			monsterHitboxPrimitives(monster, timeS, cache.world, cache.posed);
			this.hitboxes.set(monster, cache);
		}
		return cache.world.some((part) =>
			doesHitboxHitMonsterPart(start, hitbox, part),
		);
	}
}
