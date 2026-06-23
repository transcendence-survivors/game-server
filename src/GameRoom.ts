import { Client, Room } from 'colyseus';
// import { GameState, Player } from '@transcendence/game-shared';
import { GameState, Player, Vec3d } from '../../shared-package';

export class GameRoom extends Room {
	onCreate() {
		this.state = new GameState();
		this.onMessage('move', (client: Client, pos: Vec3d) => {
			const player = this.state.players.get(client.sessionId);
			if (player) {
				player.x = pos.x;
				player.y = pos.y;
				player.z = pos.z;
			}
			console.log(player);
		});
	}

	onJoin(client: Client) {
		this.state.players.set(client.sessionId, new Player());
	}

	onLeave(client: Client) {
		this.state.players.delete(client.sessionId);
	}

	onDispose() {}
}
