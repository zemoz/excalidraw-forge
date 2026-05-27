// Wire-protocol constants shared by the collab client and server. Names and
// values match the original Excalidraw socket.io contract so an excalidraw-room
// server (or a stock Excalidraw client) could in principle interop with this
// app on either end.

export const WS_EVENTS = {
  /** Client → server: reliable broadcast (scene init/update). */
  SERVER: "server-broadcast",
  /** Client → server: lossy broadcast (cursor, idle). */
  SERVER_VOLATILE: "server-volatile-broadcast",
  /** Server → other peers: relayed payload. */
  CLIENT: "client-broadcast",
  /** Server → just-connected client: emit your join-room now. */
  INIT_ROOM: "init-room",
  /** Client → server: subscribe to a room. */
  JOIN_ROOM: "join-room",
  /** Server → client: you're alone in this room. */
  FIRST_IN_ROOM: "first-in-room",
  /** Server → existing peers: a new socket joined; push them SCENE_INIT. */
  NEW_USER: "new-user",
  /** Server → room: the current list of socket ids in the room. */
  ROOM_USER_CHANGE: "room-user-change",
} as const;

/** Body-level discriminator inside the encrypted payload. */
export const WS_SUBTYPES = {
  INIT: "SCENE_INIT",
  UPDATE: "SCENE_UPDATE",
  MOUSE_LOCATION: "MOUSE_LOCATION",
  IDLE_STATUS: "IDLE_STATUS",
} as const;

export type WsSubtype = (typeof WS_SUBTYPES)[keyof typeof WS_SUBTYPES];
