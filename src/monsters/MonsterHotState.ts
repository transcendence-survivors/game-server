import {
	MONSTER_DIRECTOR_CONFIG,
	nextPowerOfTwoCapacity,
	type Monster,
} from '@transcendence/game-shared';
import type { MonsterRuntime } from './MonsterRuntime';

const INITIAL_CAPACITY = 32;

export class MonsterHotState {
	positionX = new Float64Array(INITIAL_CAPACITY);
	positionY = new Float64Array(INITIAL_CAPACITY);
	positionZ = new Float64Array(INITIAL_CAPACITY);
	rotationY = new Float64Array(INITIAL_CAPACITY);
	lastX = new Float64Array(INITIAL_CAPACITY);
	lastZ = new Float64Array(INITIAL_CAPACITY);
	publishedX = new Float64Array(INITIAL_CAPACITY);
	publishedZ = new Float64Array(INITIAL_CAPACITY);
	publishedRotationY = new Float64Array(INITIAL_CAPACITY);
	attackCooldownS = new Float64Array(INITIAL_CAPACITY);
	specialCooldownS = new Float64Array(INITIAL_CAPACITY);
	chargeCooldownS = new Float64Array(INITIAL_CAPACITY);
	chargeRemainingS = new Float64Array(INITIAL_CAPACITY);
	knockbackVelocityX = new Float64Array(INITIAL_CAPACITY);
	knockbackVelocityZ = new Float64Array(INITIAL_CAPACITY);
	knockbackRemainingS = new Float64Array(INITIAL_CAPACITY);
	knockbackProtected = new Uint8Array(INITIAL_CAPACITY);
	groundDirty = new Uint8Array(INITIAL_CAPACITY);

	initialize(slot: number, monster: Monster, runtime: MonsterRuntime): void {
		this.ensureCapacity(slot + 1);
		this.positionX[slot] =
			this.lastX[slot] =
			this.publishedX[slot] =
				monster.x;
		this.positionY[slot] = monster.y;
		this.positionZ[slot] =
			this.lastZ[slot] =
			this.publishedZ[slot] =
				monster.z;
		this.rotationY[slot] = this.publishedRotationY[slot] =
			monster.rotationY;
		this.attackCooldownS[slot] =
			MONSTER_DIRECTOR_CONFIG.initialAttackCooldownS;
		this.specialCooldownS[slot] = Math.min(
			MONSTER_DIRECTOR_CONFIG.initialSpecialCooldownS,
			runtime.definition.ai.specialCooldownS,
		);
		this.chargeCooldownS[slot] =
			MONSTER_DIRECTOR_CONFIG.initialChargeCooldownS;
		this.chargeRemainingS[slot] =
			this.knockbackVelocityX[slot] =
			this.knockbackVelocityZ[slot] =
			this.knockbackRemainingS[slot] =
			this.knockbackProtected[slot] =
			this.groundDirty[slot] =
				0;
	}

	private ensureCapacity(required: number): void {
		if (required <= this.positionX.length) return;
		const capacity = nextPowerOfTwoCapacity(
			required,
			this.positionX.length,
		);

		for (const key of FLOAT_FIELDS) {
			const grown = new Float64Array(capacity);
			grown.set(this[key]);
			this[key] = grown;
		}
		for (const key of FLAG_FIELDS) {
			const grown = new Uint8Array(capacity);
			grown.set(this[key]);
			this[key] = grown;
		}
	}
}

const FLOAT_FIELDS = [
	'positionX',
	'positionY',
	'positionZ',
	'rotationY',
	'lastX',
	'lastZ',
	'publishedX',
	'publishedZ',
	'publishedRotationY',
	'attackCooldownS',
	'specialCooldownS',
	'chargeCooldownS',
	'chargeRemainingS',
	'knockbackVelocityX',
	'knockbackVelocityZ',
	'knockbackRemainingS',
] as const;

const FLAG_FIELDS = ['knockbackProtected', 'groundDirty'] as const;
