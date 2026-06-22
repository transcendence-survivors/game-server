import { BunWebSockets } from '@colyseus/bun-websockets';
import { env } from 'bun';
import { matchMaker, Server } from 'colyseus';
import { GameRoom } from './GameRoom';

matchMaker.controller.getCorsHeaders = () => ({
	'Access-Control-Allow-Origin': 'http://localhost:5173',
	'Access-Control-Allow-Credentials': 'true',
});

const gameServer = new Server({ transport: new BunWebSockets() });

gameServer.define('game', GameRoom);

console.log('Listening on port 4000');
await gameServer.listen(env.PORT);
