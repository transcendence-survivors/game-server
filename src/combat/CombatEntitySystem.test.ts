import { describe, expect, test } from 'bun:test';
import type { ClientArray } from 'colyseus';
import { GameState, Life, Monster, Player } from '@transcendence/game-shared';
import {
	CombatEntitySystem,
	type SpawnCombatEntity,
} from './CombatEntitySystem';
import { DamageResolver } from './DamageResolver';
import { KillRewardSystem } from './KillRewardSystem';
import type { MonsterSimulationSource } from '../monsters/MonsterSimulationSource';

function createSystem(monsterSimulation?: MonsterSimulationSource) {
	const state = new GameState();
	state.players.set('player', new Player());
	const clients = { getById: () => undefined } as unknown as ClientArray;
	const damage = new DamageResolver(
		state,
		new KillRewardSystem(state, clients),
	);
	const system = new CombatEntitySystem(
		state,
		damage,
		() => 0,
		monsterSimulation,
	);
	return { state, system };
}

function projectile(
	overrides: Partial<SpawnCombatEntity> = {},
): SpawnCombatEntity {
	return {
		kind: 'arrow',
		weaponKind: 'bow',
		ownerSessionId: 'player',
		behavior: 'projectile',
		x: 0,
		y: 1,
		z: 0,
		lifetimeS: 2,
		damage: 10,
		collisionRadius: 0.5,
		velocityX: 10,
		...overrides,
	};
}

function addMonster(state: GameState, id: string, x: number, z = 0) {
	const monster = new Monster();
	monster.x = x;
	monster.z = z;
	monster.life = new Life(50);
	state.monsters.set(id, monster);
	return monster;
}

describe('CombatEntitySystem', () => {
	test('reuses one monster hitbox snapshot at the same combat time', () => {
		const { state, system } = createSystem();
		const monster = addMonster(state, 'target', 0, 4);
		const first = system.monsterHitboxesAt(1).get('target')![0];
		const repeated = system.monsterHitboxesAt(1).get('target')![0];
		expect(repeated).toBe(first);
		monster.x = 3;
		const refreshed = system.monsterHitboxesAt(2).get('target')![0];
		expect(refreshed).not.toBe(first);
		expect(refreshed.x).toBe(3);
	});

	test('moves projectiles deterministically and detects swept collisions', () => {
		const { state, system } = createSystem();
		const monster = addMonster(state, 'monster', 5);
		const entity = system.spawn(projectile());
		expect(entity).toBeDefined();
		system.update(1);
		expect(monster.life.current).toBe(40);
		expect(state.combatEntities.size).toBe(0);
	});

	test('uses exact authoritative transforms and the shared crowd index', () => {
		const simulation: MonsterSimulationSource = {
			readTransform(id, output) {
				if (id !== 'monster') return false;
				output.x = 5;
				output.y = 0;
				output.z = 0;
				output.rotationY = 0;
				return true;
			},
			queryRadius(_x, _z, _radius, result) {
				result.length = 0;
				result.push('monster');
				return result;
			},
			querySwept(_start, _end, _radius, result = []) {
				result.length = 0;
				result.push('monster');
				return result;
			},
		};
		const { state, system } = createSystem(simulation);
		const monster = addMonster(state, 'monster', 50);

		system.spawn(projectile());
		system.update(1);

		expect(monster.life.current).toBe(40);
	});

	test('hits the visible edge of a monster hitbox', () => {
		const { state, system } = createSystem();
		const monster = addMonster(state, 'wide-monster', 5, 1.4);
		monster.hitboxRadius = 1;
		system.spawn(projectile());
		system.update(1);
		expect(monster.life.current).toBe(40);
	});

	test('honors penetration before removing a projectile', () => {
		const { state, system } = createSystem();
		const first = addMonster(state, 'first', 3);
		const second = addMonster(state, 'second', 7);
		system.spawn(projectile({ penetration: 1 }));
		system.update(1);
		expect(first.life.current).toBe(40);
		expect(second.life.current).toBe(40);
		expect(state.combatEntities.size).toBe(0);
	});

	test('applies persistent contact cooldowns and expires exactly', () => {
		const { state, system } = createSystem();
		const monster = addMonster(state, 'monster', 0);
		// Garde la cible dans la zone apres le premier recul afin d'isoler ici le
		// comportement du cooldown de contact.
		monster.hitboxRadius = 3;
		const entity = system.spawn({
			...projectile(),
			kind: 'axe',
			weaponKind: 'axe',
			behavior: 'persistent-zone',
			velocityX: 0,
			lifetimeS: 1,
			contactIntervalS: 0.5,
		});
		system.update(0.1);
		system.update(0.2);
		system.update(0.3);
		expect(monster.life.current).toBe(30);
		expect(state.combatEntities.has(entity!.id)).toBe(true);
		system.update(0.4);
		expect(state.combatEntities.has(entity!.id)).toBe(false);
	});

	test('keeps contact cooldowns independent between shared behaviors', () => {
		const { state, system } = createSystem();
		const monster = addMonster(state, 'monster', 0);
		monster.hitboxRadius = 3;
		const zone = {
			...projectile(),
			kind: 'axe' as const,
			weaponKind: 'axe' as const,
			behavior: 'persistent-zone' as const,
			velocityX: 0,
			contactIntervalS: 1,
		};
		system.spawn(zone);
		system.spawn(zone);
		system.update(0.1);
		expect(monster.life.current).toBe(30);
	});

	test('removes owned entities when their player leaves', () => {
		const { state, system } = createSystem();
		system.spawn(projectile());
		state.players.delete('player');
		system.update(0.1);
		expect(state.combatEntities.size).toBe(0);
	});

	test('keeps only synchronized data in the schema', () => {
		const { state, system } = createSystem();
		const entity = system.spawn(projectile({ targetId: 'missing' }))!;
		expect(state.combatEntities.get(entity.id)).toBe(entity);
		system.update(0.1);
		expect(entity.targetId).toBe('');
		expect(Object.hasOwn(entity, 'damage')).toBe(false);
		expect(Object.hasOwn(entity, 'hitAtS')).toBe(false);
	});
});
