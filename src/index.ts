import { matchMaker, Server } from 'colyseus';
import { Encoder } from '@colyseus/schema';
import { GameRoom } from './GameRoom';
import { BunWebSockets } from '@colyseus/bun-websockets';
import {
	GAME_ROOM_TYPE,
	GAME_ROOM_NAME_PROPERTY,
	STATE_ENCODER_BUFFER_SIZE,
} from '@transcendence/game-shared';

export const { API_INTERNAL, JWT_GAME_TOKEN_SECRET } = process.env;

if (!API_INTERNAL || !JWT_GAME_TOKEN_SECRET) throw new Error('missing env');

Encoder.BUFFER_SIZE = STATE_ENCODER_BUFFER_SIZE;

export const GAME_SECRET = new TextEncoder().encode(JWT_GAME_TOKEN_SECRET);

matchMaker.controller.getCorsHeaders = (reqHeaders) => ({
	'Access-Control-Allow-Origin': reqHeaders.get('origin') || '*',
	'Access-Control-Allow-Credentials': 'true',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers':
		'Origin, X-Requested-With, Content-Type, Accept, Authorization',
});

const gameServer = new Server({ transport: new BunWebSockets() });

gameServer.define(GAME_ROOM_TYPE, GameRoom).filterBy([GAME_ROOM_NAME_PROPERTY]);

await gameServer.listen(Number(4000), '0.0.0.0');
