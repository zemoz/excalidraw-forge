import type { EncryptedFile, EncryptedScene, RoomStore } from "./types";

// Process-local store — everything is lost on restart. Good enough as the
// zero-config default; swap in Postgres for persistence.
export class InMemoryRoomStore implements RoomStore {
  private readonly scenes = new Map<string, EncryptedScene>();
  private readonly files = new Map<string, Map<string, EncryptedFile>>();

  async getScene(roomId: string): Promise<EncryptedScene | null> {
    return this.scenes.get(roomId) ?? null;
  }

  async saveScene(
    roomId: string,
    incoming: EncryptedScene,
  ): Promise<EncryptedScene> {
    const existing = this.scenes.get(roomId);
    if (existing && existing.sceneVersion >= incoming.sceneVersion) {
      return existing;
    }
    this.scenes.set(roomId, incoming);
    return incoming;
  }

  async deleteScene(roomId: string): Promise<void> {
    this.scenes.delete(roomId);
    this.files.delete(roomId);
  }

  async getFile(
    roomId: string,
    fileId: string,
  ): Promise<EncryptedFile | null> {
    return this.files.get(roomId)?.get(fileId) ?? null;
  }

  async saveFile(
    roomId: string,
    fileId: string,
    file: EncryptedFile,
  ): Promise<void> {
    let bucket = this.files.get(roomId);
    if (!bucket) {
      bucket = new Map();
      this.files.set(roomId, bucket);
    }
    bucket.set(fileId, file);
  }
}
