import { io, type Socket } from "socket.io-client";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import { WS_EVENTS, WS_SUBTYPES, type WsSubtype } from "@shared/protocol";

import { decryptData, encryptData } from "./crypto";

// Mirrors the original SocketUpdateDataSource (excalidraw-app/data/index.ts).
// The server never sees decrypted bodies — these types only describe the
// payloads exchanged peer-to-peer.
export type SceneInitData = {
  type: typeof WS_SUBTYPES.INIT;
  payload: { elements: readonly OrderedExcalidrawElement[] };
};

export type SceneUpdateData = {
  type: typeof WS_SUBTYPES.UPDATE;
  payload: { elements: readonly OrderedExcalidrawElement[] };
};

export type MouseLocationData = {
  type: typeof WS_SUBTYPES.MOUSE_LOCATION;
  payload: {
    socketId: string;
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "down" | "up";
    selectedElementIds: Record<string, true>;
    username: string;
  };
};

export type SocketUpdateData =
  | SceneInitData
  | SceneUpdateData
  | MouseLocationData;

export type PortalCallbacks = {
  onRoomUserChange: (socketIds: string[]) => void;
  onSceneInit: (elements: readonly OrderedExcalidrawElement[]) => void;
  onSceneUpdate: (elements: readonly OrderedExcalidrawElement[]) => void;
  onMouseLocation: (payload: MouseLocationData["payload"]) => void;
  // Called when this socket is the only one in the room. The caller is then
  // responsible for hydrating the scene from HTTP storage.
  onFirstInRoom: () => void;
  // Called when another peer joins so the caller can push a full SCENE_INIT
  // to bring them up to date.
  onNewPeer: (socketId: string) => void;
};

export class Portal {
  socket: Socket | null = null;
  roomId: string | null = null;
  roomKey: string | null = null;
  // Per-element version we've already broadcast. Used to filter deltas so we
  // only send elements that genuinely changed. Cleared on close.
  private readonly broadcastedVersions = new Map<string, number>();

  private readonly callbacks: PortalCallbacks;

  constructor(callbacks: PortalCallbacks) {
    this.callbacks = callbacks;
  }

  open(url: string | undefined, roomId: string, roomKey: string): Socket {
    this.roomId = roomId;
    this.roomKey = roomKey;
    // Empty URL → same origin (one Node server hosts the SPA + Socket.io).
    this.socket = url ? io(url) : io();

    this.socket.on(WS_EVENTS.INIT_ROOM, () => {
      this.socket?.emit(WS_EVENTS.JOIN_ROOM, roomId);
    });

    this.socket.on(WS_EVENTS.FIRST_IN_ROOM, () => {
      this.callbacks.onFirstInRoom();
    });

    this.socket.on(WS_EVENTS.NEW_USER, (socketId: string) => {
      this.callbacks.onNewPeer(socketId);
    });

    this.socket.on(WS_EVENTS.ROOM_USER_CHANGE, (clients: string[]) => {
      this.callbacks.onRoomUserChange(clients);
    });

    this.socket.on(
      WS_EVENTS.CLIENT,
      async (encryptedData: ArrayBuffer, iv: ArrayBuffer) => {
        if (!this.roomKey) return;
        try {
          const decrypted = await decryptData(this.roomKey, iv, encryptedData);
          const json = new TextDecoder().decode(decrypted);
          const data = JSON.parse(json) as SocketUpdateData;
          this.dispatch(data);
        } catch (err) {
          console.error("[collab] failed to decrypt incoming message", err);
        }
      },
    );

    return this.socket;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.roomId = null;
    this.roomKey = null;
    this.broadcastedVersions.clear();
  }

  isOpen(): boolean {
    return !!(this.socket && this.roomId && this.roomKey);
  }

  // Send the full scene to peers (used on initial sync and periodic resync).
  // `syncAll` skips the version filter.
  async broadcastScene(
    type: WsSubtype,
    elements: readonly OrderedExcalidrawElement[],
    syncAll: boolean,
  ): Promise<void> {
    if (!this.isOpen()) return;
    if (type === WS_SUBTYPES.INIT && !syncAll) {
      throw new Error("syncAll must be true when sending SCENE_INIT");
    }

    const toSend: OrderedExcalidrawElement[] = [];
    for (const el of elements) {
      const lastVersion = this.broadcastedVersions.get(el.id);
      if (syncAll || lastVersion === undefined || el.version > lastVersion) {
        toSend.push(el);
      }
    }

    if (toSend.length === 0 && !syncAll) return;

    for (const el of toSend) {
      this.broadcastedVersions.set(el.id, el.version);
    }

    const data =
      type === WS_SUBTYPES.INIT
        ? ({ type: WS_SUBTYPES.INIT, payload: { elements: toSend } } as SceneInitData)
        : ({
            type: WS_SUBTYPES.UPDATE,
            payload: { elements: toSend },
          } as SceneUpdateData);

    await this.emit(data, /* volatile */ false);
  }

  async broadcastMouseLocation(
    payload: MouseLocationData["payload"],
  ): Promise<void> {
    if (!this.isOpen()) return;
    const data: MouseLocationData = {
      type: WS_SUBTYPES.MOUSE_LOCATION,
      payload,
    };
    await this.emit(data, /* volatile */ true);
  }

  private async emit(
    data: SocketUpdateData,
    volatile: boolean,
  ): Promise<void> {
    const roomKey = this.roomKey;
    const roomId = this.roomId;
    if (!this.socket || !roomKey || !roomId) return;
    const json = JSON.stringify(data);
    const encoded = new TextEncoder().encode(json);
    const { encryptedBuffer, iv } = await encryptData(roomKey, encoded);
    // Re-check after the async hop — close() may have nulled the socket
    // while we were encrypting.
    if (!this.socket) return;
    const event = volatile ? WS_EVENTS.SERVER_VOLATILE : WS_EVENTS.SERVER;
    this.socket.emit(event, roomId, encryptedBuffer, iv);
  }

  private dispatch(data: SocketUpdateData): void {
    switch (data.type) {
      case WS_SUBTYPES.INIT:
        this.callbacks.onSceneInit(data.payload.elements);
        break;
      case WS_SUBTYPES.UPDATE:
        this.callbacks.onSceneUpdate(data.payload.elements);
        break;
      case WS_SUBTYPES.MOUSE_LOCATION:
        this.callbacks.onMouseLocation(data.payload);
        break;
    }
  }
}
