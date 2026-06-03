/**
 * @file A {@link LobbyRoom} that lists **public** game rooms only.
 *
 * Why not `room.setPrivate(true)` on private games? Colyseus' `private` flag
 * hides a room from listings **and** makes it unmatchable by `client.join(...)`
 * — which would break joining a private game by name. So private games stay
 * matchable (their password is enforced in `GameRoom.onAuth`) and are instead
 * kept out of the public directory here, by filtering on `metadata.mode`.
 *
 * Both the initial snapshot (`filterItemsForClient`) and the realtime
 * add/update/remove path (`filterItemForClient`) funnel through our predicate,
 * so a private room is never streamed to a browsing client.
 *
 * The base methods are typed against internal `IRoomCache` / `LobbyOptions`
 * types that Colyseus does not re-export, so the overrides use `any` to stay
 * signature-compatible and read `metadata.mode` structurally.
 */

import { LobbyRoom } from 'colyseus';
import { RoomMode } from '@transcendence/game-shared';

/** Whether a cached room entry should be visible in the public directory. */
function isPublicRoom(room: { metadata?: { mode?: string } } | undefined): boolean {
	return room?.metadata?.mode === RoomMode.Public;
}

export class PublicLobbyRoom extends LobbyRoom {
	/** A room is visible only if its metadata marks it public. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- base types are not re-exported
	protected override filterItemForClient(room: any, filter?: any): boolean {
		if (!isPublicRoom(room)) {
			return false;
		}
		// Honour any per-client `filter` (name/metadata) the base class supports.
		return super.filterItemForClient(room, filter);
	}

	/**
	 * The base implementation returns the full cache verbatim when a client has
	 * no explicit filter — which would leak private rooms in the initial
	 * snapshot. Always run every room through {@link filterItemForClient}.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- base types are not re-exported
	protected override filterItemsForClient(options: any): any {
		return this.rooms.filter((room) => this.filterItemForClient(room, options?.filter));
	}
}
