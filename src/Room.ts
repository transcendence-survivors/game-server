import { Client } from 'colyseus';
import { Player } from '@transcendence/game-shared';

export class Room {
	onJoin(client: Client) {
		console.log(client.sessionId, 'joined');
		const player = new Player();
		player.x = 0;
		player.y = 1;
		player.z = 0;
		this.state.players;
	}
}
