import type { Server, Socket } from "socket.io";

import { WS_EVENTS } from "@shared/protocol";

// Socket.io handlers — pure relay. The server never sees plaintext: it just
// forwards opaque encrypted buffers between peers in the same room.
export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    // Tell the client it can now send its join-room.
    socket.emit(WS_EVENTS.INIT_ROOM);

    socket.on(WS_EVENTS.JOIN_ROOM, async (roomId: string) => {
      if (typeof roomId !== "string" || !roomId) return;

      await socket.join(roomId);

      const room = io.sockets.adapter.rooms.get(roomId);
      const clientIds = room ? Array.from(room) : [];

      if (clientIds.length <= 1) {
        // We're alone — the client will load the scene from HTTP storage.
        socket.emit(WS_EVENTS.FIRST_IN_ROOM);
      } else {
        // Existing peers should push us the current scene via SCENE_INIT.
        socket.to(roomId).emit(WS_EVENTS.NEW_USER, socket.id);
      }

      io.in(roomId).emit(WS_EVENTS.ROOM_USER_CHANGE, clientIds);
    });

    // Reliable broadcast — scene init/update.
    socket.on(
      WS_EVENTS.SERVER,
      (roomId: string, encryptedData: ArrayBuffer, iv: ArrayBuffer) => {
        socket.broadcast
          .to(roomId)
          .emit(WS_EVENTS.CLIENT, encryptedData, iv);
      },
    );

    // Volatile broadcast — cursors/idle. A dropped frame is fine.
    socket.on(
      WS_EVENTS.SERVER_VOLATILE,
      (roomId: string, encryptedData: ArrayBuffer, iv: ArrayBuffer) => {
        socket.volatile.broadcast
          .to(roomId)
          .emit(WS_EVENTS.CLIENT, encryptedData, iv);
      },
    );

    // Emit a final room-user-change after this socket leaves so peers can
    // drop the cursor/avatar immediately.
    socket.on("disconnecting", () => {
      for (const roomId of socket.rooms) {
        if (roomId === socket.id) continue;
        const room = io.sockets.adapter.rooms.get(roomId);
        const remaining = room
          ? Array.from(room).filter((id) => id !== socket.id)
          : [];
        socket.to(roomId).emit(WS_EVENTS.ROOM_USER_CHANGE, remaining);
      }
    });
  });
}
