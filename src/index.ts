import { env } from 'bun';
import { matchMaker, Server } from 'colyseus';
import { GameRoom } from './GameRoom';
import { BunWebSockets } from '@colyseus/bun-websockets';

matchMaker.controller.getCorsHeaders = (reqHeaders) => ({
	'Access-Control-Allow-Origin': reqHeaders.get('origin') || '*',
	'Access-Control-Allow-Credentials': 'true',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers':
		'Origin, X-Requested-With, Content-Type, Accept, Authorization',
});

const gameServer = new Server({ transport: new BunWebSockets() });

gameServer.define('game_room', GameRoom).filterBy(['roomName']);

await gameServer.listen(Number(env.PORT ?? 4000), '0.0.0.0');
