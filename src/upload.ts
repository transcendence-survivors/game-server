import { SignJWT } from 'jose';
import { API_INTERNAL, GAME_SECRET } from '.';
import { TomeId, WeaponKind } from '@transcendence/game-shared';

enum WeaponKindUpload {
	AURA = 'AURA',
	BOW = 'BOW',
	AXE = 'AXE',
	SWORD = 'SWORD',
	STAFF = 'STAFF',
}

enum TomeKindUpload {
	DAMAGE = 'DAMAGE',
	COOLDOWN = 'COOLDOWN',
	AGILITY = 'AGILITY',
	VITALITY = 'VITALITY',
	ARMOR = 'ARMOR',
	BLOOD = 'BLOOD',
	RANGE = 'RANGE',
	SIZE = 'SIZE',
	DURATION = 'DURATION',
	QUANTITY = 'QUANTITY',
	FORTUNE = 'FORTUNE',
}

export const tomeKindMap: Record<TomeId, TomeKindUpload> = {
	damage: TomeKindUpload.DAMAGE,
	cooldown: TomeKindUpload.COOLDOWN,
	agility: TomeKindUpload.AGILITY,
	vitality: TomeKindUpload.VITALITY,
	armor: TomeKindUpload.ARMOR,
	blood: TomeKindUpload.BLOOD,
	range: TomeKindUpload.RANGE,
	size: TomeKindUpload.SIZE,
	duration: TomeKindUpload.DURATION,
	quantity: TomeKindUpload.QUANTITY,
	fortune: TomeKindUpload.FORTUNE,
};

interface Tome {
	kind: TomeKindUpload;
	level: number;
}

export const weaponKindMap: Record<WeaponKind, WeaponKindUpload> = {
	aura: WeaponKindUpload.AURA,
	bow: WeaponKindUpload.BOW,
	axe: WeaponKindUpload.AXE,
	sword: WeaponKindUpload.SWORD,
	staff: WeaponKindUpload.STAFF,
};

export interface GameStats {
	survivalTime: number;
	players: PlayerStats[];
}

interface Weapon {
	kind: WeaponKindUpload;
	level: number;
}

export interface PlayerStats {
	userId: string;
	maxHealth: number;
	attackSpeed: number;
	moveSpeed: number;
	attackDamage: number;
	armor: number;
	luck: number;
	killAmount: number;
	lifesteal: number;
	range: number;
	size: number;
	duration: number;
	quantity: number;
	penetration: number;
	weapons: Weapon[];
	tomes: Tome[];
}

export async function uploadStats(gameStats: GameStats) {
	const token = await new SignJWT({ type: 'game-server' })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('60s')
		.sign(GAME_SECRET);

	const response = await fetch(`${API_INTERNAL}/game`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(gameStats),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Failed to upload match results: ${response.status} - ${errorText}`,
		);
	}

	return await response.json();
}
