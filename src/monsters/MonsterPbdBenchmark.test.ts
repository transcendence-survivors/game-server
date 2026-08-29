import { expect, test } from 'bun:test';
import { World } from '@transcendence/game-shared';
import { MonsterManager } from '../MonsterManager';
import { createCombatTestContext } from '../testing/CombatTestFixtures';

const SATURATED_CROWD_TICK_BUDGET_MS = 10;
const SATURATED_IMPULSE_TICK_BUDGET_MS = 20;

test('keeps a saturated PBD crowd within its server tick budget', () => {
	const { state, player, damage } = createCombatTestContext();
	player.debugImmortal = true;
	const manager = new MonsterManager(new World(1), state, damage, () => 0.01);
	manager.setStressTest(true);
	for (let tick = 0; tick < 20; tick++) manager.update(1 / 20);
	for (let tick = 0; tick < 20; tick++) manager.update(1 / 20);
	const ticks = 200;
	const startedAt = performance.now();
	for (let tick = 0; tick < ticks; tick++) manager.update(1 / 20);
	const average = (performance.now() - startedAt) / ticks;
	expect(average).toBeLessThan(SATURATED_CROWD_TICK_BUDGET_MS);

	state.monsters.forEach((_monster, monsterId) =>
		damage.damageMonster(
			{
				playerId: 'player',
				weaponKind: 'sword',
				combatEntityId: 'benchmark:sword',
			},
			monsterId,
			1,
		),
	);
	damage.drainImpactEvents();
	const impulseTicks = 6;
	const impulseStartedAt = performance.now();
	for (let tick = 0; tick < impulseTicks; tick++) manager.update(1 / 20);
	const impulseAverage =
		(performance.now() - impulseStartedAt) / impulseTicks;
	expect(impulseAverage).toBeLessThan(SATURATED_IMPULSE_TICK_BUDGET_MS);
});
