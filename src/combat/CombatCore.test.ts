import { describe, expect, test } from 'bun:test';
import type { ClientArray } from 'colyseus';
import {
	GameState,
	Life,
	Monster,
	Player,
	WeaponState,
	weaponConfigRegistry,
	type AuraWeaponConfig,
} from '../../../shared-package';
import { DamageResolver } from './DamageResolver';
import { KillRewardSystem } from './KillRewardSystem';
import { Weapon, type WeaponAttackContext } from './Weapon';
import { WeaponFactory } from './WeaponFactory';
import { CombatEntitySystem } from './CombatEntitySystem';
import { AuraWeapon } from './AuraWeapon';

function createDamageResolver(state: GameState): DamageResolver {
	const clients = { getById: () => undefined } as unknown as ClientArray;
	return new DamageResolver(state, new KillRewardSystem(state, clients));
}

function createCombatState(monsterLife: number = 50) {
	const state = new GameState();
	const player = new Player();
	const monster = new Monster();
	monster.life = new Life(monsterLife);
	monster.xpReward = 10;
	state.players.set('player', player);
	state.monsters.set('monster', monster);
	return { state, player, monster };
}

function createEntities(state: GameState, damage: DamageResolver) {
	return new CombatEntitySystem(state, damage, () => 0);
}

class TestAuraWeapon extends Weapon<AuraWeaponConfig> {
	attackCount = 0;
	attackResult = true;

	protected attack(_player: Player, _context: WeaponAttackContext): boolean {
		this.attackCount++;
		return this.attackResult;
	}
}

describe('DamageResolver', () => {
	test('applies damage and emits its complete source', () => {
		const { state, monster } = createCombatState();
		const damage = createDamageResolver(state);
		const result = damage.damageMonster(
			{
				playerId: 'player',
				weaponKind: 'aura',
				combatEntityId: 'aura:player:1',
			},
			'monster',
			12,
		);
		expect(result).toEqual({ requested: 12, applied: 12, fatal: false });
		expect(monster.life.current).toBe(38);
		expect(damage.drainImpactEvents()[0]).toMatchObject({
			sourcePlayerId: 'player',
			weaponKind: 'aura',
			combatEntityId: 'aura:player:1',
		});
	});

	test('rewards one fatal hit using applied damage for lifesteal', () => {
		const { state, player } = createCombatState(5);
		player.life.takeDamage(50);
		player.stats.lifesteal = 10;
		const damage = createDamageResolver(state);
		const source = {
			playerId: 'player',
			weaponKind: 'sword' as const,
			combatEntityId: 'slash:1',
		};
		const first = damage.damageMonster(source, 'monster', 100);
		const second = damage.damageMonster(source, 'monster', 100);
		expect(first).toEqual({ requested: 100, applied: 5, fatal: true });
		expect(second.applied).toBe(0);
		expect(player.stats.killAmount).toBe(1);
		expect(player.life.current).toBe(50.5);
		expect(state.monsters.has('monster')).toBe(false);
	});

	test('resolves simultaneous player hits with one deterministic kill credit', () => {
		const { state, player: first, monster } = createCombatState(10);
		const second = new Player();
		second.life.takeDamage(20);
		second.stats.lifesteal = 50;
		state.players.set('second', second);
		const damage = createDamageResolver(state);
		const firstHit = damage.damageMonster(
			{ playerId: 'player', weaponKind: 'aura', combatEntityId: 'first' },
			'monster',
			6,
		);
		const secondHit = damage.damageMonster(
			{ playerId: 'second', weaponKind: 'bow', combatEntityId: 'second' },
			'monster',
			6,
		);
		expect(firstHit).toEqual({ requested: 6, applied: 6, fatal: false });
		expect(secondHit).toEqual({ requested: 6, applied: 4, fatal: true });
		expect(first.stats.killAmount).toBe(0);
		expect(second.stats.killAmount).toBe(1);
		expect(second.experience.xp).toBe(monster.xpReward);
		expect(second.life.current).toBe(82);
		expect(state.monsters.has('monster')).toBe(false);
		expect(damage.drainImpactEvents()).toHaveLength(2);
	});

	test('reports every level gained from one reward', () => {
		const { state, monster } = createCombatState(1);
		monster.xpReward = 1000;
		const sent: string[] = [];
		const gained: number[] = [];
		const clients = {
			getById: () => ({ send: (message: string) => sent.push(message) }),
		} as unknown as ClientArray;
		const damage = new DamageResolver(
			state,
			new KillRewardSystem(state, clients, (_playerId, levels) =>
				gained.push(levels),
			),
		);
		damage.damageMonster(
			{
				playerId: 'player',
				weaponKind: 'sword',
				combatEntityId: 'fatal',
			},
			'monster',
			1,
		);
		expect(gained).toEqual([sent.length]);
		expect(sent.length).toBeGreaterThan(1);
	});
});

describe('Weapon', () => {
	test('starts with a full cooldown and triggers deterministically', () => {
		const { state, player } = createCombatState();
		const damage = createDamageResolver(state);
		const weaponState = new WeaponState();
		weaponState.kind = 'aura';
		const weapon = new TestAuraWeapon(
			'player',
			weaponState,
			weaponConfigRegistry.get('aura'),
		);
		const context = {
			roomState: state,
			damage,
			entities: createEntities(state, damage),
			elapsedS: 0,
		};
		weapon.update(0.5, player, context);
		expect(weapon.attackCount).toBe(0);
		weapon.update(0.5, player, context);
		expect(weapon.attackCount).toBe(1);
		expect(weaponState.activationSequence).toBe(1);
	});

	test('does not consume a failed attack', () => {
		const { state, player } = createCombatState();
		const damage = createDamageResolver(state);
		const weaponState = new WeaponState();
		weaponState.kind = 'aura';
		const weapon = new TestAuraWeapon(
			'player',
			weaponState,
			weaponConfigRegistry.get('aura'),
		);
		weapon.attackResult = false;
		const entities = createEntities(state, damage);
		weapon.update(1, player, {
			roomState: state,
			damage,
			entities,
			elapsedS: 1,
		});
		expect(weaponState.activationSequence).toBe(0);
		weapon.attackResult = true;
		weapon.update(0.01, player, {
			roomState: state,
			damage,
			entities,
			elapsedS: 1.01,
		});
		expect(weaponState.activationSequence).toBe(1);
	});

	test('caps catch-up attacks after a large delta', () => {
		const { state, player } = createCombatState();
		const damage = createDamageResolver(state);
		const weaponState = new WeaponState();
		weaponState.kind = 'aura';
		const weapon = new TestAuraWeapon(
			'player',
			weaponState,
			weaponConfigRegistry.get('aura'),
		);
		weapon.update(100, player, {
			roomState: state,
			damage,
			entities: createEntities(state, damage),
			elapsedS: 100,
		});
		expect(weapon.attackCount).toBe(4);
		expect(weaponState.activationSequence).toBe(4);
	});
});

describe('WeaponFactory', () => {
	test('creates registered weapons and rejects missing constructors', () => {
		const factory = new WeaponFactory(weaponConfigRegistry);
		const state = new WeaponState();
		state.kind = 'aura';
		expect(() => factory.create('player', state)).toThrow(
			'Weapon constructor not registered: aura',
		);
		factory.register(
			'aura',
			(ownerSessionId, weaponState, config) =>
				new TestAuraWeapon(
					ownerSessionId,
					weaponState,
					config as Readonly<AuraWeaponConfig>,
				),
		);
		expect(factory.create('player', state)).toBeInstanceOf(TestAuraWeapon);
	});
});

describe('four-player combat recipe', () => {
	test('updates four authoritative loadouts against the same room state', () => {
		const state = new GameState();
		const monster = new Monster();
		monster.life = new Life(100);
		state.monsters.set('shared-target', monster);
		for (let index = 0; index < 4; index++)
			state.players.set(`player-${index}`, new Player());
		const damage = createDamageResolver(state);
		const entities = createEntities(state, damage);
		for (let index = 0; index < 4; index++) {
			const weaponState = new WeaponState();
			weaponState.kind = 'aura';
			new AuraWeapon(
				`player-${index}`,
				weaponState,
				weaponConfigRegistry.get('aura'),
			).update(1, state.players.get(`player-${index}`)!, {
				roomState: state,
				damage,
				entities,
				elapsedS: 1,
			});
		}
		expect(monster.life.current).toBe(80);
		expect(damage.drainImpactEvents()).toHaveLength(4);
	});
});
