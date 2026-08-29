import { env } from 'bun';
import { matchMaker, Server } from 'colyseus';
import { Encoder } from '@colyseus/schema';
import { GameRoom } from './GameRoom';
import { BunWebSockets } from '@colyseus/bun-websockets';
import {
	GAME_ROOM_TYPE,
	GAME_ROOM_NAME_PROPERTY,
	STATE_ENCODER_BUFFER_SIZE,
} from '@transcendence/game-shared';

// The denser director can legitimately exceed schema's default 8 KB snapshot.
Encoder.BUFFER_SIZE = STATE_ENCODER_BUFFER_SIZE;

matchMaker.controller.getCorsHeaders = (reqHeaders) => ({
	'Access-Control-Allow-Origin': reqHeaders.get('origin') || '*',
	'Access-Control-Allow-Credentials': 'true',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers':
		'Origin, X-Requested-With, Content-Type, Accept, Authorization',
});

const gameServer = new Server({ transport: new BunWebSockets() });

gameServer.define(GAME_ROOM_TYPE, GameRoom).filterBy([GAME_ROOM_NAME_PROPERTY]);

await gameServer.listen(Number(env.PORT ?? 4000), '0.0.0.0');
