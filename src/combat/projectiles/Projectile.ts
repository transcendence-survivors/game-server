import {
	COMBAT_LIMITS,
	CombatEntity,
	type Vec3d,
	WEAPON_CONFIGS,
} from '@transcendence/game-shared';
import type { CombatSystem } from '../CombatSystem';
import type { DamageSource } from '../damage/DamageResolver';

type EntityFields = Pick<
	CombatEntity,
	'kind' | 'weaponKind' | 'x' | 'y' | 'z' | 'directionX' | 'directionZ'
> &
	Partial<
		Pick<
			CombatEntity,
			| 'rotationY'
			| 'scale'
			| 'targetId'
			| 'hitboxShape'
			| 'hitboxRadius'
			| 'hitboxHeight'
			| 'hitboxWidth'
			| 'hitboxDepth'
			| 'hitboxHalfAngle'
		>
	>;

export interface ProjectileSpawn extends EntityFields {
	lifetimeS: number;
	damage: number;
	velocityX?: number;
	velocityZ?: number;
	penetration?: number;
	contactIntervalS?: number;
	terrainOffset?: number;
	travelDistance?: number;
	speed?: number;
	turnRateRadiansS?: number;
}

export class Projectile {
	readonly entity = new CombatEntity();
	private readonly hitAtS = new Map<string, number>();
	private readonly previous = { x: 0, y: 0, z: 0 };
	private readonly source: DamageSource;
	private readonly damage: number;
	private readonly speed: number;
	private readonly contactIntervalS: number;
	private readonly terrainOffset: number;
	private readonly turnRateRadiansS: number;
	private velocityX: number;
	private velocityZ: number;
	private penetration: number;
	private travelRemaining: number;

	constructor(
		id: string,
		owner: string,
		spawn: ProjectileSpawn,
		nowS: number,
	) {
		const {
			lifetimeS,
			damage,
			velocityX = 0,
			velocityZ = 0,
			penetration = 0,
			contactIntervalS = Infinity,
			terrainOffset = 0,
			travelDistance = 0,
			speed = 0,
			turnRateRadiansS = 0,
			...fields
		} = spawn;
		Object.assign(this.entity, fields, {
			id,
			ownerSessionId: owner,
			expiresAtS:
				nowS + Math.min(lifetimeS, COMBAT_LIMITS.maxEntityLifetimeS),
		});
		const knockback = WEAPON_CONFIGS[fields.weaponKind].baseKnockback;
		this.source = { playerId: owner, knockback };
		this.damage = damage;
		this.speed =
			fields.kind === 'axe' ? Math.hypot(velocityX, velocityZ) : speed;
		this.contactIntervalS = contactIntervalS;
		this.terrainOffset = terrainOffset;
		this.turnRateRadiansS = turnRateRadiansS;
		this.velocityX = velocityX;
		this.velocityZ = velocityZ;
		this.penetration = penetration;
		this.travelRemaining = travelDistance;
	}

	update(dtSeconds: number, combat: CombatSystem): boolean {
		const { entity } = this;
		switch (entity.kind) {
			case 'arrow':
				this.move(dtSeconds);
				if (
					entity.y <=
					combat.terrainHeight(entity.x, entity.z) +
						this.terrainOffset
				)
					return false;
				return this.hit(combat, this.previous, true);
			case 'fireball':
				this.steer(dtSeconds, combat);
				this.move(dtSeconds);
				this.followTerrain(combat);
				return this.hit(combat, this.previous, true);
			case 'axe':
				if (this.travelRemaining > 0 && !this.travel(dtSeconds, combat))
					return true;
				this.followTerrain(combat);
				return this.hit(combat, entity, false);
			default:
				return true;
		}
	}

	private move(dtSeconds: number): void {
		const { entity, previous } = this;
		previous.x = entity.x;
		previous.y = entity.y;
		previous.z = entity.z;
		entity.x += this.velocityX * dtSeconds;
		entity.z += this.velocityZ * dtSeconds;
	}

	private followTerrain(combat: CombatSystem): void {
		const { entity } = this;
		entity.y =
			combat.terrainHeight(entity.x, entity.z) + this.terrainOffset;
	}

	private steer(dtSeconds: number, combat: CombatSystem): void {
		const { entity } = this;
		const target = combat.monster(entity.targetId);
		if (!target) {
			entity.targetId = '';
			return;
		}
		const desired = Math.atan2(target.z - entity.z, target.x - entity.x);
		const current = Math.atan2(this.velocityZ, this.velocityX);
		const delta = Math.atan2(
			Math.sin(desired - current),
			Math.cos(desired - current),
		);
		const maxTurn = this.turnRateRadiansS * dtSeconds;
		const heading = current + Math.max(-maxTurn, Math.min(maxTurn, delta));
		entity.directionX = Math.cos(heading);
		entity.directionZ = Math.sin(heading);
		this.velocityX = entity.directionX * this.speed;
		this.velocityZ = entity.directionZ * this.speed;
	}

	private travel(dtSeconds: number, combat: CombatSystem): boolean {
		const { entity } = this;
		const distance = Math.min(this.travelRemaining, this.speed * dtSeconds);
		if (this.speed > 0) {
			entity.x += (this.velocityX / this.speed) * distance;
			entity.z += (this.velocityZ / this.speed) * distance;
		}
		this.travelRemaining -= distance;
		this.followTerrain(combat);
		if (this.travelRemaining > Number.EPSILON) return false;
		this.travelRemaining = 0;
		return true;
	}

	private hit(combat: CombatSystem, start: Vec3d, pierces: boolean): boolean {
		const { damage } = combat;
		for (const id of combat.monstersHitBy(start, this.entity)) {
			const lastHitS = this.hitAtS.get(id);
			if (
				(lastHitS !== undefined &&
					combat.nowS - lastHitS < this.contactIntervalS) ||
				damage.damageMonster(this.source, id, this.damage) <= 0
			)
				continue;
			this.hitAtS.set(id, combat.nowS);
			if (!pierces) continue;
			if (this.penetration <= 0) return false;
			this.penetration--;
		}
		return true;
	}
}
