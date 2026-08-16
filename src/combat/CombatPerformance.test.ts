import { describe, expect, test } from 'bun:test';
import { Encoder } from '@colyseus/schema';
import type { ClientArray } from 'colyseus';
import {
	COMBAT_LIMITS,
	GameState,
	Life,
	MONSTER_MAX_POPULATION,
	MONSTER_KINDS,
	Monster,
	Player,
	WEAPON_KINDS,
	WeaponState,
	weaponConfigRegistry,
} from '../../../shared-package';
import { CombatEntitySystem } from './CombatEntitySystem';
import { CombatSystem } from './CombatSystem';
import { createWeaponFactory } from './createWeaponFactory';
import { DamageResolver } from './DamageResolver';
import { KillRewardSystem } from './KillRewardSystem';

const LOAD_BUDGET = {
	averageTickMs: 20,
	maximumPatchBytes: 256 * 1024,
} as const;

describe('maximum combat load', () => {
	test('keeps four full loadouts and maximum monster population within budgets', () => {
		const state = new GameState();
		for (let playerIndex = 0; playerIndex < 4; playerIndex++) {
			const player = new Player();
			player.x = playerIndex * 0.5;
			for (const kind of WEAPON_KINDS) {
				const weapon = new WeaponState();
				weapon.kind = kind;
				weapon.level = weaponConfigRegistry.get(kind).maxLevel;
				player.weapons.set(kind, weapon);
			}
			state.players.set(`player-${playerIndex}`, player);
		}
		for (let index = 0; index < MONSTER_MAX_POPULATION; index++) {
			const monster = new Monster();
			monster.kind = MONSTER_KINDS[index % MONSTER_KINDS.length];
			const angle = (index / MONSTER_MAX_POPULATION) * Math.PI * 2;
			const radius = 3 + (index % 8);
			monster.x = Math.cos(angle) * radius;
			monster.z = Math.sin(angle) * radius;
			monster.life = new Life(1_000_000_000);
			state.monsters.set(`monster-${index}`, monster);
		}
		const clients = { getById: () => undefined } as unknown as ClientArray;
		const damage = new DamageResolver(
			state,
			new KillRewardSystem(state, clients),
		);
		const entities = new CombatEntitySystem(state, damage, () => 0);
		const combat = new CombatSystem(
			state,
			damage,
			createWeaponFactory(),
			entities,
		);
		const encoder = new Encoder(state);
		encoder.encodeAll();
		encoder.discardChanges();
		let maximumPatchBytes = 0;
		const ticks = 120;
		const startedAt = performance.now();
		for (let tick = 0; tick < ticks; tick++) {
			combat.update(1 / 20);
			entities.update(1 / 20);
			damage.drainImpactEvents();
			maximumPatchBytes = Math.max(
				maximumPatchBytes,
				encoder.encode().byteLength,
			);
			encoder.discardChanges();
			expect(state.combatEntities.size).toBeLessThanOrEqual(
				COMBAT_LIMITS.maxCombatEntitiesPerRoom,
			);
		}
		const averageTickMs = (performance.now() - startedAt) / ticks;
		expect(state.players.size).toBe(4);
		expect(state.monsters.size).toBe(MONSTER_MAX_POPULATION);
		expect(averageTickMs).toBeLessThan(LOAD_BUDGET.averageTickMs);
		expect(maximumPatchBytes).toBeLessThan(LOAD_BUDGET.maximumPatchBytes);
	});
});
