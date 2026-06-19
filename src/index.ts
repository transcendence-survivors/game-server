import { BunWebSockets } from '@colyseus/bun-websockets';
import { env } from 'bun';
import { matchMaker, Room, Server } from 'colyseus';
import { GameRoom } from './GameRoom';

matchMaker.controller.getCorsHeaders = () => ({
	'Access-Control-Allow-Origin': 'http://localhost:5173',
	'Access-Control-Allow-Credentials': 'true',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers':
		'Origin, X-Requested-With, Content-Type, Accept, Authorization',
	Vary: 'Origin',
});

const gameServer = new Server({ transport: new BunWebSockets() });

gameServer.define('game', GameRoom);

console.log('Listening on port 4000');
// await gameServer.listen(env.PORT);
const room = new GameRoom();
