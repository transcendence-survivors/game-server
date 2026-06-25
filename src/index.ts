import { env } from 'bun';
import { matchMaker, Server } from 'colyseus';
import { GameRoom } from './GameRoom';
import { BunWebSockets } from '@colyseus/bun-websockets';

matchMaker.controller.getCorsHeaders = () => ({
	'Access-Control-Allow-Origin': 'http://localhost:5173',
	'Access-Control-Allow-Credentials': 'true',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers':
		'Origin, X-Requested-With, Content-Type, Accept, Authorization',
});

const gameServer = new Server({ transport: new BunWebSockets() });

gameServer.define('game', GameRoom);

console.log('Listening on port 4000');
await gameServer.listen(env.PORT);
