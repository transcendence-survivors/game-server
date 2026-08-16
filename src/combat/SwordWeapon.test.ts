import { describe, expect, test } from 'bun:test';
import type { ClientArray } from 'colyseus';
import {
	GameState,
	Life,
	Monster,
	Player,
	WeaponState,
	weaponConfigRegistry,
} from '../../../shared-package';
import { CombatEntitySystem } from './CombatEntitySystem';
import { DamageResolver } from './DamageResolver';
import { KillRewardSystem } from './KillRewardSystem';
import { SwordWeapon } from './SwordWeapon';

function setup(rotationY = 0) {
	const state = new GameState();
	const player = new Player();
	player.rotationY = rotationY;
	state.players.set('player', player);
	const clients = { getById: () => undefined } as unknown as ClientArray;
	const damage = new DamageResolver(
		state,
		new KillRewardSystem(state, clients),
	);
	const entities = new CombatEntitySystem(state, damage, () => 0);
	const weaponState = new WeaponState();
	weaponState.kind = 'sword';
	const weapon = new SwordWeapon(
		'player',
		weaponState,
		weaponConfigRegistry.get('sword'),
	);
	return { state, player, damage, entities, weapon };
}

function monsterAt(state: GameState, id: string, x: number, z: number) {
	const monster = new Monster();
	monster.x = x;
	monster.z = z;
	monster.life = new Life(100);
	state.monsters.set(id, monster);
	return monster;
}

describe('SwordWeapon', () => {
	test('hits front and sector edge once but never hits behind', () => {
		const { state, player, damage, entities, weapon } = setup();
		const front = monsterAt(state, 'front', 0, 3);
		const edgeAngle = (50 * Math.PI) / 180;
		const edge = monsterAt(
			state,
			'edge',
			Math.sin(edgeAngle) * 4,
			Math.cos(edgeAngle) * 4,
		);
		const behind = monsterAt(state, 'behind', 0, -2);
		weapon.update(0.8, player, {
			roomState: state,
			damage,
			entities,
			elapsedS: 0.8,
		});
		expect(front.life.current).toBe(82);
		expect(edge.life.current).toBe(82);
		expect(behind.life.current).toBe(100);
		expect(front.x).toBeCloseTo(0);
		expect(front.z).toBeCloseTo(6);
		expect(Math.hypot(edge.x, edge.z)).toBeCloseTo(7);
		expect(behind.z).toBe(-2);
		expect(state.combatEntities.size).toBe(1);
		expect(damage.drainImpactEvents()).toHaveLength(2);
	});

	test('uses captured rotations for simultaneous player attacks', () => {
		const first = setup(Math.PI / 2);
		const secondPlayer = new Player();
		secondPlayer.x = 20;
		secondPlayer.rotationY = -Math.PI / 2;
		first.state.players.set('second', secondPlayer);
		const secondState = new WeaponState();
		secondState.kind = 'sword';
		const secondWeapon = new SwordWeapon(
			'second',
			secondState,
			weaponConfigRegistry.get('sword'),
		);
		const firstTarget = monsterAt(first.state, 'first-target', 3, 0);
		const secondTarget = monsterAt(first.state, 'second-target', 17, 0);
		const context = {
			roomState: first.state,
			damage: first.damage,
			entities: first.entities,
			elapsedS: 0.8,
		};
		first.weapon.update(0.8, first.player, {
			...context,
		});
		secondWeapon.update(0.8, secondPlayer, context);
		const slashes = [...first.state.combatEntities.values()];
		expect(firstTarget.life.current).toBe(82);
		expect(secondTarget.life.current).toBe(82);
		expect(slashes).toHaveLength(2);
		expect(slashes[0].rotationY).toBe(Math.PI / 2);
		expect(slashes[0].directionX).toBeCloseTo(1);
		expect(slashes[1].rotationY).toBe(-Math.PI / 2);
		expect(slashes[1].directionX).toBeCloseTo(-1);
	});
});
