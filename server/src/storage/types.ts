// Storage contract for room scenes and per-file blobs. The server never
// decrypts these — it just persists the opaque ciphertext + IV that the
// client encrypted with the room key.

export interface EncryptedScene {
  iv: Buffer;
  ciphertext: Buffer;
  sceneVersion: number;
  updatedAt: number;
}

export interface EncryptedFile {
  iv: Buffer;
  ciphertext: Buffer;
  updatedAt: number;
}

export interface RoomStore {
  getScene(roomId: string): Promise<EncryptedScene | null>;
  /**
   * Last-writer-wins on `sceneVersion`. If a stale write arrives the existing
   * (newer) scene is kept; the returned value is whichever scene ended up
   * stored, so the caller can reconcile against it.
   */
  saveScene(roomId: string, scene: EncryptedScene): Promise<EncryptedScene>;
  deleteScene(roomId: string): Promise<void>;

  getFile(roomId: string, fileId: string): Promise<EncryptedFile | null>;
  /** Files are content-addressed by `fileId`; a second upload overwrites. */
  saveFile(
    roomId: string,
    fileId: string,
    file: EncryptedFile,
  ): Promise<void>;
}
