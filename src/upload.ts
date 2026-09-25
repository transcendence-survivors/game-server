import { SignJWT } from 'jose';
import { API_INTERNAL, GAME_SECRET } from '.';
import { WeaponKind } from '@transcendence/game-shared';

export enum WeaponKindUpload {
	AURA = 'AURA',
	BOW = 'BOW',
	AXE = 'AXE',
	SWORD = 'SWORD',
	STAFF = 'STAFF',
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

export interface Weapon {
	kind: WeaponKindUpload;
	level: number;
}

export interface PlayerStats {
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
}

export async function uploadStats(gameStats: GameStats) {
	const token = await new SignJWT()
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
		const errorText = await response.text;
		throw new Error(
			`Failed to upload match results: ${response.status} - ${errorText}`,
		);
	}

	return await response.json();
}
