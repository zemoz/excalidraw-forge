import { generateEncryptionKey } from "./crypto";

const ROOM_ID_BYTES = 10;
const RE_COLLAB_LINK = /^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/;

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export type RoomCredentials = { roomId: string; roomKey: string };

export const generateRoomCredentials = async (): Promise<RoomCredentials> => {
  const buffer = new Uint8Array(ROOM_ID_BYTES);
  window.crypto.getRandomValues(buffer);
  return {
    roomId: bytesToHex(buffer),
    roomKey: await generateEncryptionKey(),
  };
};

export const parseRoomFromHash = (hash: string): RoomCredentials | null => {
  const match = hash.match(RE_COLLAB_LINK);
  if (!match) return null;
  // The exported AES-GCM JWK is always 22 base64 chars.
  if (match[2].length !== 22) return null;
  return { roomId: match[1], roomKey: match[2] };
};

export const buildRoomLink = ({ roomId, roomKey }: RoomCredentials): string =>
  `${window.location.origin}${window.location.pathname}#room=${roomId},${roomKey}`;
