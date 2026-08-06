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
		const context = { roomState: state, damage, elapsedS: 0 };
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
		weapon.update(1, player, { roomState: state, damage, elapsedS: 1 });
		expect(weaponState.activationSequence).toBe(0);
		weapon.attackResult = true;
		weapon.update(0.01, player, {
			roomState: state,
			damage,
			elapsedS: 1.01,
		});
		expect(weaponState.activationSequence).toBe(1);
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
