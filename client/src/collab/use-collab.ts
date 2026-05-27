import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import { CollabSession } from "./collab-session";
import {
  buildRoomLink,
  generateRoomCredentials,
  parseRoomFromHash,
  type RoomCredentials,
} from "./room-link";
import { throttle } from "./throttle";

// ~30fps — matches the original; high enough to feel smooth, low enough to
// avoid flooding the volatile WS channel.
const CURSOR_SYNC_TIMEOUT_MS = 33;

const randomUsername = () => {
  const adjectives = ["Quick", "Calm", "Brave", "Wise", "Bright", "Kind"];
  const animals = ["Fox", "Otter", "Hawk", "Lynx", "Wolf", "Crane"];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const n = animals[Math.floor(Math.random() * animals.length)];
  return `${a}${n}${Math.floor(Math.random() * 100)}`;
};

export type UseCollabReturn = {
  isCollaborating: boolean;
  collaborators: Map<SocketId, Collaborator>;
  roomLink: string | null;
  setExcalidrawAPI: (api: ExcalidrawImperativeAPI | null) => void;
  startCollab: () => Promise<void>;
  stopCollab: () => void;
  onChange: (
    elements: readonly OrderedExcalidrawElement[],
    files: BinaryFiles,
  ) => void;
  onPointerUpdate: (payload: {
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "down" | "up";
    pointersMap: Map<number, unknown>;
  }) => void;
};

export const useCollab = (): UseCollabReturn => {
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [collaborators, setCollaborators] = useState<
    Map<SocketId, Collaborator>
  >(new Map());
  const [roomLink, setRoomLink] = useState<string | null>(null);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const sessionRef = useRef<CollabSession | null>(null);
  const usernameRef = useRef<string>(randomUsername());
  // Once we've auto-started from URL hash, don't try again.
  const autoStartedRef = useRef(false);
  // Bumped when the Excalidraw API becomes available, so the auto-start
  // effect can run exactly once at that point.
  const [apiReadyTick, setApiReadyTick] = useState(0);

  const setExcalidrawAPI = useCallback(
    (api: ExcalidrawImperativeAPI | null) => {
      apiRef.current = api;
      if (api) setApiReadyTick((t) => t + 1);
    },
    [],
  );

  const startWithCredentials = useCallback(
    async (credentials: RoomCredentials) => {
      const api = apiRef.current;
      if (!api) {
        console.warn("[collab] excalidrawAPI not ready");
        return;
      }
      if (sessionRef.current) sessionRef.current.stop();

      const session = new CollabSession(api, usernameRef.current, {
        onCollaboratorsChange: (next) => setCollaborators(new Map(next)),
        onConnected: () => setIsCollaborating(true),
        onDisconnected: () => setIsCollaborating(false),
      });
      sessionRef.current = session;

      window.history.replaceState({}, "", buildRoomLink(credentials));
      setRoomLink(buildRoomLink(credentials));

      await session.start(credentials);
    },
    [],
  );

  const startCollab = useCallback(async () => {
    autoStartedRef.current = true;
    const existing = parseRoomFromHash(window.location.hash);
    const creds = existing ?? (await generateRoomCredentials());
    await startWithCredentials(creds);
  }, [startWithCredentials]);

  const stopCollab = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setRoomLink(null);
    window.history.replaceState(
      {},
      "",
      `${window.location.origin}${window.location.pathname}`,
    );
  }, []);

  // Auto-start when the page loads with a #room= hash, but only once the
  // Excalidraw API is ready.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!apiRef.current) return;
    const creds = parseRoomFromHash(window.location.hash);
    if (!creds) return;
    autoStartedRef.current = true;
    void startWithCredentials(creds);
  }, [apiReadyTick, startWithCredentials]);

  // Clean up on unmount.
  useEffect(
    () => () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    },
    [],
  );

  const onChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      files: BinaryFiles,
    ) => {
      sessionRef.current?.syncElements(elements, files);
    },
    [],
  );

  // Throttled cursor broadcast.
  const throttledPointerSync = useMemo(
    () =>
      throttle((payload: {
        pointer: { x: number; y: number; tool: "pointer" | "laser" };
        button: "down" | "up";
      }) => {
        sessionRef.current?.syncPointer(payload);
      }, CURSOR_SYNC_TIMEOUT_MS),
    [],
  );

  const onPointerUpdate = useCallback(
    (payload: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" };
      button: "down" | "up";
      pointersMap: Map<number, unknown>;
    }) => {
      // Skip multi-touch — matches the original behavior.
      if (payload.pointersMap.size >= 2) return;
      throttledPointerSync({
        pointer: payload.pointer,
        button: payload.button,
      });
    },
    [throttledPointerSync],
  );

  return {
    isCollaborating,
    collaborators,
    roomLink,
    setExcalidrawAPI,
    startCollab,
    stopCollab,
    onChange,
    onPointerUpdate,
  };
};
