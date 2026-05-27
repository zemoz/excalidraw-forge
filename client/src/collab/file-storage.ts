import type {
  BinaryFileData,
  DataURL,
} from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";

import type { FileBlobRequest, FileBlobResponse } from "@shared/http";

import { decryptData, encryptData } from "./crypto";
import { fromBase64, toBase64 } from "./base64";

// Encrypts a file's dataURL with the room key and uploads the ciphertext.
// The server stores only an opaque blob — same trust model as scene snapshots.
export const uploadFile = async (
  roomId: string,
  roomKey: string,
  fileId: FileId,
  file: BinaryFileData,
): Promise<void> => {
  const payload = JSON.stringify({
    mimeType: file.mimeType,
    dataURL: file.dataURL,
    created: file.created ?? Date.now(),
  });
  const { encryptedBuffer, iv } = await encryptData(
    roomKey,
    new TextEncoder().encode(payload),
  );
  const body: FileBlobRequest = {
    iv: toBase64(iv),
    ciphertext: toBase64(encryptedBuffer),
  };
  const res = await fetch(`/api/rooms/${roomId}/files/${fileId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to upload file ${fileId}: ${res.status}`);
  }
};

// Returns null on 404 so callers can retry; throws on network/decrypt error.
export const fetchFile = async (
  roomId: string,
  roomKey: string,
  fileId: FileId,
): Promise<BinaryFileData | null> => {
  const res = await fetch(`/api/rooms/${roomId}/files/${fileId}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch file ${fileId}: ${res.status}`);
  }
  const body = (await res.json()) as FileBlobResponse;
  const decrypted = await decryptData(
    roomKey,
    fromBase64(body.iv),
    fromBase64(body.ciphertext),
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
    mimeType: string;
    dataURL: string;
    created: number;
  };
  return {
    id: fileId,
    mimeType: parsed.mimeType as BinaryFileData["mimeType"],
    dataURL: parsed.dataURL as DataURL,
    created: parsed.created,
  };
};
