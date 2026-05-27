import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { getSceneVersion } from "@excalidraw/excalidraw";

import type {
  SceneSnapshotPutResponse,
  SceneSnapshotRequest,
  SceneSnapshotResponse,
} from "@shared/http";

import { decryptData, encryptData } from "./crypto";
import { fromBase64, toBase64 } from "./base64";

// Client-side wrapper over the server's encrypted-snapshot endpoints.
// Mirrors the role Firebase plays in the original app: a place to fetch the
// drawing from when joining an empty room, and a place to push the latest
// state to when the room is active.

export const loadSceneFromServer = async (
  roomId: string,
  roomKey: string,
): Promise<{
  elements: readonly OrderedExcalidrawElement[];
  sceneVersion: number;
} | null> => {
  const res = await fetch(`/api/rooms/${roomId}/scene`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load scene: ${res.status}`);
  const body = (await res.json()) as SceneSnapshotResponse;
  const decrypted = await decryptData(
    roomKey,
    fromBase64(body.iv),
    fromBase64(body.ciphertext),
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
    elements: readonly OrderedExcalidrawElement[];
  };
  return { elements: parsed.elements, sceneVersion: body.sceneVersion };
};

export const saveSceneToServer = async (
  roomId: string,
  roomKey: string,
  elements: readonly OrderedExcalidrawElement[],
): Promise<SceneSnapshotPutResponse | null> => {
  const payload = JSON.stringify({ elements });
  const { encryptedBuffer, iv } = await encryptData(
    roomKey,
    new TextEncoder().encode(payload),
  );
  const body: SceneSnapshotRequest = {
    iv: toBase64(iv),
    ciphertext: toBase64(encryptedBuffer),
    sceneVersion: getSceneVersion(elements),
  };
  const res = await fetch(`/api/rooms/${roomId}/scene`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return (await res.json()) as SceneSnapshotPutResponse;
};
