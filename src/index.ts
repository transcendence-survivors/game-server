import { Server } from 'colyseus';
import { BunWebSockets } from '@colyseus/bun-websockets';
import { GameRoom } from './rooms/GameRoom';

const { PORT } = process.env;

if (!PORT) {
	throw new Error('PORT is not defined in environment variables');
}

const gameServer = new Server({
	transport: new BunWebSockets({}),
});

gameServer.define('survivor', GameRoom);

gameServer.listen(PORT).then(() => {
	console.log(`[game-rt] Colyseus listening on ws://0.0.0.0:${PORT}`);
});
