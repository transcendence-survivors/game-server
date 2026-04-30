import { Schema, MapSchema, type } from '@colyseus/schema';

export class PlayerState extends Schema {
	@type('string') sessionId: string = '';
	@type('string') name: string = 'Player';
	@type('number') x: number = 0;
	@type('number') y: number = 0;
	@type('number') z: number = 0;
	@type('number') hp: number = 100;
	@type('number') maxHp: number = 100;
	@type('number') joinedAt: number = 0;
}

export class GameState extends Schema {
	@type('number') startedAt: number = 0;
	@type('number') tick: number = 0;
	@type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
