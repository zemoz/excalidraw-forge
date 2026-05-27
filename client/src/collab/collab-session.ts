import {
  CaptureUpdateAction,
  getSceneVersion,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import type {
  BinaryFileData,
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";
import type {
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";

import { WS_SUBTYPES } from "@shared/protocol";

import { Portal, type MouseLocationData } from "./portal";
import { loadSceneFromServer, saveSceneToServer } from "./scene-storage";
import { fetchFile, uploadFile } from "./file-storage";
import type { RoomCredentials } from "./room-link";

// How often to push a full snapshot regardless of whether anything changed,
// to recover from any peer that dropped a delta message.
const SYNC_FULL_SCENE_INTERVAL_MS = 20_000;
// How long to wait after a scene change before persisting to the server.
const SCENE_PERSIST_INTERVAL_MS = 10_000;

// Minimal duck-type for image elements — avoids depending on a private
// `isInitializedImageElement` helper. Mirrors the original's check shape.
type ImageElementLike = OrderedExcalidrawElement & {
  type: "image";
  fileId: FileId | null;
  status: "pending" | "saved" | "error";
};
const isLoadableImageElement = (
  el: OrderedExcalidrawElement,
): el is ImageElementLike =>
  el.type === "image" && !el.isDeleted && !!(el as ImageElementLike).fileId;

// reconcileElements expects elements branded as "remote" — runtime cast.
const asRemote = (elements: readonly OrderedExcalidrawElement[]): any =>
  elements;

export type CollabEventHandlers = {
  onCollaboratorsChange: (collaborators: Map<SocketId, Collaborator>) => void;
  onConnected: () => void;
  onDisconnected: () => void;
};

export class CollabSession {
  private portal: Portal;
  private excalidrawAPI: ExcalidrawImperativeAPI;
  private credentials: RoomCredentials | null = null;
  private username: string;
  private fullSyncInterval: ReturnType<typeof setInterval> | null = null;
  private persistTimeout: ReturnType<typeof setTimeout> | null = null;
  private collaborators: Map<SocketId, Collaborator> = new Map();
  private readonly handlers: CollabEventHandlers;
  // FileIds we've already pushed to the server during this session.
  private readonly uploadedFileIds = new Set<FileId>();
  // FileIds currently being fetched (or just fetched) so we don't re-fetch.
  private readonly fetchingFileIds = new Set<FileId>();

  constructor(
    excalidrawAPI: ExcalidrawImperativeAPI,
    username: string,
    handlers: CollabEventHandlers,
  ) {
    this.excalidrawAPI = excalidrawAPI;
    this.username = username;
    this.handlers = handlers;
    this.portal = new Portal({
      onRoomUserChange: this.handleRoomUserChange,
      onSceneInit: this.handleSceneInit,
      onSceneUpdate: this.handleSceneUpdate,
      onMouseLocation: this.handleMouseLocation,
      onFirstInRoom: this.handleFirstInRoom,
      onNewPeer: this.handleNewPeer,
    });
  }

  async start(credentials: RoomCredentials): Promise<void> {
    this.credentials = credentials;
    this.portal.open(undefined, credentials.roomId, credentials.roomKey);
    this.fullSyncInterval = setInterval(
      this.broadcastFullScene,
      SYNC_FULL_SCENE_INTERVAL_MS,
    );
    this.handlers.onConnected();
  }

  stop(): void {
    if (this.fullSyncInterval) clearInterval(this.fullSyncInterval);
    if (this.persistTimeout) clearTimeout(this.persistTimeout);
    this.fullSyncInterval = null;
    this.persistTimeout = null;
    this.portal.close();
    this.collaborators = new Map();
    this.uploadedFileIds.clear();
    this.fetchingFileIds.clear();
    this.excalidrawAPI.updateScene({ collaborators: this.collaborators });
    this.handlers.onCollaboratorsChange(this.collaborators);
    this.handlers.onDisconnected();
  }

  // Called from Excalidraw's onChange. Uploads any newly-added image files
  // first (so peers fetching the file after seeing the element don't 404),
  // then broadcasts the scene delta and schedules a server snapshot save.
  syncElements(
    elements: readonly OrderedExcalidrawElement[],
    files: BinaryFiles,
  ): void {
    if (!this.portal.isOpen()) return;
    void this.uploadNewFiles(elements, files).then(() => {
      void this.portal.broadcastScene(WS_SUBTYPES.UPDATE, elements, false);
    });
    this.schedulePersist();
  }

  // Called from Excalidraw's onPointerUpdate. Pre-throttled by the caller.
  syncPointer(payload: {
    pointer: MouseLocationData["payload"]["pointer"];
    button: MouseLocationData["payload"]["button"];
  }): void {
    if (!this.portal.isOpen() || !this.portal.socket?.id) return;
    void this.portal.broadcastMouseLocation({
      socketId: this.portal.socket.id,
      pointer: payload.pointer,
      button: payload.button ?? "up",
      selectedElementIds: this.excalidrawAPI.getAppState().selectedElementIds,
      username: this.username,
    });
  }

  // ---- internal: peer / room lifecycle ------------------------------------

  private handleRoomUserChange = (socketIds: string[]): void => {
    const next = new Map<SocketId, Collaborator>();
    const selfId = this.portal.socket?.id;
    for (const id of socketIds) {
      if (id === selfId) continue;
      const existing = this.collaborators.get(id as SocketId);
      next.set(id as SocketId, existing ?? { username: "" });
    }
    this.collaborators = next;
    // Also push to Excalidraw so cursors of peers who left disappear.
    this.excalidrawAPI.updateScene({ collaborators: next });
    this.handlers.onCollaboratorsChange(next);
  };

  private handleFirstInRoom = async (): Promise<void> => {
    if (!this.credentials) return;
    try {
      const saved = await loadSceneFromServer(
        this.credentials.roomId,
        this.credentials.roomKey,
      );
      if (saved) {
        const restored = restoreElements(saved.elements, null);
        this.excalidrawAPI.updateScene({
          elements: restored,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        void this.fetchMissingFiles(restored);
      }
    } catch (err) {
      console.error("[collab] failed to load scene from server", err);
    }
  };

  private handleNewPeer = (_socketId: string): void => {
    // A new user joined — push them the full scene as SCENE_INIT.
    const elements = this.excalidrawAPI.getSceneElementsIncludingDeleted();
    void this.portal.broadcastScene(WS_SUBTYPES.INIT, elements, true);
    // Files we've uploaded earlier are already on the server; the peer will
    // fetch them itself after applying SCENE_INIT.
  };

  // ---- internal: incoming scene updates -----------------------------------

  private handleSceneInit = (
    elements: readonly OrderedExcalidrawElement[],
  ): void => {
    this.applyRemoteElements(elements);
  };

  private handleSceneUpdate = (
    elements: readonly OrderedExcalidrawElement[],
  ): void => {
    this.applyRemoteElements(elements);
  };

  private applyRemoteElements(
    remoteElements: readonly OrderedExcalidrawElement[],
  ): void {
    const local = this.excalidrawAPI.getSceneElementsIncludingDeleted();
    const appState = this.excalidrawAPI.getAppState();
    const restoredRemote = restoreElements(remoteElements, null);
    const reconciled = reconcileElements(
      local,
      asRemote(restoredRemote),
      appState,
    );
    this.excalidrawAPI.updateScene({
      elements: reconciled,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    void this.fetchMissingFiles(reconciled);
  }

  // ---- internal: cursors --------------------------------------------------

  private handleMouseLocation = (
    payload: MouseLocationData["payload"],
  ): void => {
    const socketId = payload.socketId as SocketId;
    if (socketId === (this.portal.socket?.id as SocketId)) return;
    // Build a fresh Map — Excalidraw compares `collaborators` by reference,
    // so mutating in place and passing the same Map would skip the render.
    const next = new Map(this.collaborators);
    const existing = next.get(socketId) ?? {};
    next.set(socketId, {
      ...existing,
      pointer: payload.pointer,
      button: payload.button,
      selectedElementIds: payload.selectedElementIds,
      username: payload.username,
    });
    this.collaborators = next;
    this.excalidrawAPI.updateScene({ collaborators: next });
    this.handlers.onCollaboratorsChange(next);
  };

  // ---- internal: full sync / persistence ---------------------------------

  private broadcastFullScene = (): void => {
    if (!this.portal.isOpen()) return;
    const elements = this.excalidrawAPI.getSceneElementsIncludingDeleted();
    void this.portal.broadcastScene(WS_SUBTYPES.UPDATE, elements, true);
  };

  private schedulePersist(): void {
    if (this.persistTimeout) return;
    this.persistTimeout = setTimeout(() => {
      this.persistTimeout = null;
      this.persistNow();
    }, SCENE_PERSIST_INTERVAL_MS);
  }

  private async persistNow(): Promise<void> {
    if (!this.credentials) return;
    const elements = this.excalidrawAPI.getSceneElementsIncludingDeleted();
    if (getSceneVersion(elements) === 0) return;
    try {
      await saveSceneToServer(
        this.credentials.roomId,
        this.credentials.roomKey,
        elements,
      );
    } catch (err) {
      console.error("[collab] failed to persist scene", err);
    }
  }

  // ---- internal: image file sync ------------------------------------------

  // Uploads any image file referenced by the scene but not yet pushed during
  // this session. Returns once all in-flight uploads either succeed or fail.
  private async uploadNewFiles(
    elements: readonly OrderedExcalidrawElement[],
    files: BinaryFiles,
  ): Promise<void> {
    if (!this.credentials) return;
    const tasks: Promise<void>[] = [];
    const { roomId, roomKey } = this.credentials;
    for (const el of elements) {
      if (!isLoadableImageElement(el)) continue;
      const fileId = el.fileId as FileId;
      if (this.uploadedFileIds.has(fileId)) continue;
      const file = files[fileId];
      if (!file) continue; // dataURL not yet hydrated locally
      this.uploadedFileIds.add(fileId);
      tasks.push(
        uploadFile(roomId, roomKey, fileId, file).catch((err) => {
          this.uploadedFileIds.delete(fileId); // allow retry on next change
          console.error("[collab] file upload failed", fileId, err);
        }),
      );
    }
    if (tasks.length) await Promise.all(tasks);
  }

  // Fetches any image file referenced by the scene but missing from the local
  // files map. Adds successfully-loaded files to the scene via addFiles.
  private async fetchMissingFiles(
    elements: readonly OrderedExcalidrawElement[],
  ): Promise<void> {
    if (!this.credentials) return;
    const { roomId, roomKey } = this.credentials;
    const localFiles = this.excalidrawAPI.getFiles();
    const toFetch: FileId[] = [];
    for (const el of elements) {
      if (!isLoadableImageElement(el)) continue;
      const fileId = el.fileId as FileId;
      if (localFiles[fileId]) continue;
      if (this.fetchingFileIds.has(fileId)) continue;
      toFetch.push(fileId);
    }
    if (!toFetch.length) return;

    for (const id of toFetch) this.fetchingFileIds.add(id);

    const results = await Promise.all(
      toFetch.map(async (fileId): Promise<BinaryFileData | null> => {
        try {
          return await fetchFile(roomId, roomKey, fileId);
        } catch (err) {
          console.error("[collab] file fetch failed", fileId, err);
          return null;
        }
      }),
    );

    const loaded: BinaryFileData[] = [];
    results.forEach((file, i) => {
      const fileId = toFetch[i];
      if (file) {
        loaded.push(file);
      } else {
        // 404 or error — drop from in-flight so a later broadcast can retry.
        this.fetchingFileIds.delete(fileId);
      }
    });

    if (loaded.length) {
      this.excalidrawAPI.addFiles(loaded);
    }
  }

  get socketId(): string | undefined {
    return this.portal.socket?.id;
  }
}
