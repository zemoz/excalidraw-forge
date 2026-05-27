import { InMemoryRoomStore } from "./in-memory";
import { PostgresRoomStore } from "./postgres";
import type { RoomStore } from "./types";

export type { EncryptedFile, EncryptedScene, RoomStore } from "./types";

// In-memory is the zero-config default. Set DATABASE_URL to a Postgres
// connection string to persist instead. No middle ground — keeping the env
// surface small (one variable, present or absent).
export const createRoomStore = async (): Promise<RoomStore> => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[storage] in-memory (set DATABASE_URL to use Postgres)");
    return new InMemoryRoomStore();
  }
  const store = new PostgresRoomStore(url);
  await store.init();
  console.log("[storage] Postgres");
  return store;
};
