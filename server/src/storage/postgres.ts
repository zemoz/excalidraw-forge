import pg from "pg";

import type { EncryptedFile, EncryptedScene, RoomStore } from "./types";

const { Pool } = pg;

// Schema. Kept inline because two tables don't justify a migration tool yet.
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS scenes (
    room_id        TEXT        PRIMARY KEY,
    iv             BYTEA       NOT NULL,
    ciphertext     BYTEA       NOT NULL,
    scene_version  INTEGER     NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS files (
    room_id    TEXT        NOT NULL,
    file_id    TEXT        NOT NULL,
    iv         BYTEA       NOT NULL,
    ciphertext BYTEA       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, file_id)
  );
`;

interface SceneRow {
  iv: Buffer;
  ciphertext: Buffer;
  scene_version: number;
  updated_at: Date;
}

interface FileRow {
  iv: Buffer;
  ciphertext: Buffer;
  updated_at: Date;
}

const sceneRowToScene = (row: SceneRow): EncryptedScene => ({
  iv: row.iv,
  ciphertext: row.ciphertext,
  sceneVersion: row.scene_version,
  updatedAt: row.updated_at.getTime(),
});

const fileRowToFile = (row: FileRow): EncryptedFile => ({
  iv: row.iv,
  ciphertext: row.ciphertext,
  updatedAt: row.updated_at.getTime(),
});

export class PostgresRoomStore implements RoomStore {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async getScene(roomId: string): Promise<EncryptedScene | null> {
    const { rows } = await this.pool.query<SceneRow>(
      `SELECT iv, ciphertext, scene_version, updated_at
         FROM scenes
        WHERE room_id = $1`,
      [roomId],
    );
    return rows[0] ? sceneRowToScene(rows[0]) : null;
  }

  // INSERT ... ON CONFLICT ... WHERE gives us last-writer-wins atomically:
  // the UPDATE branch only fires if the incoming sceneVersion is strictly
  // higher than the stored one. If it isn't, RETURNING is empty and we
  // round-trip to fetch the (winning, existing) row.
  async saveScene(
    roomId: string,
    incoming: EncryptedScene,
  ): Promise<EncryptedScene> {
    const { rows } = await this.pool.query<SceneRow>(
      `INSERT INTO scenes (room_id, iv, ciphertext, scene_version, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (room_id) DO UPDATE SET
           iv            = EXCLUDED.iv,
           ciphertext    = EXCLUDED.ciphertext,
           scene_version = EXCLUDED.scene_version,
           updated_at    = EXCLUDED.updated_at
           WHERE scenes.scene_version < EXCLUDED.scene_version
         RETURNING iv, ciphertext, scene_version, updated_at`,
      [
        roomId,
        incoming.iv,
        incoming.ciphertext,
        incoming.sceneVersion,
        new Date(incoming.updatedAt),
      ],
    );
    if (rows[0]) return sceneRowToScene(rows[0]);

    // Stale write: return whatever's actually stored.
    const existing = await this.getScene(roomId);
    if (!existing) {
      // Conflict implied a row existed; can't really reach here, but if we
      // do, fall back to returning the incoming value.
      return incoming;
    }
    return existing;
  }

  async deleteScene(roomId: string): Promise<void> {
    await this.pool.query(`DELETE FROM scenes WHERE room_id = $1`, [roomId]);
    await this.pool.query(`DELETE FROM files  WHERE room_id = $1`, [roomId]);
  }

  async getFile(
    roomId: string,
    fileId: string,
  ): Promise<EncryptedFile | null> {
    const { rows } = await this.pool.query<FileRow>(
      `SELECT iv, ciphertext, updated_at
         FROM files
        WHERE room_id = $1 AND file_id = $2`,
      [roomId, fileId],
    );
    return rows[0] ? fileRowToFile(rows[0]) : null;
  }

  async saveFile(
    roomId: string,
    fileId: string,
    file: EncryptedFile,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO files (room_id, file_id, iv, ciphertext, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (room_id, file_id) DO UPDATE SET
           iv         = EXCLUDED.iv,
           ciphertext = EXCLUDED.ciphertext,
           updated_at = EXCLUDED.updated_at`,
      [roomId, fileId, file.iv, file.ciphertext, new Date(file.updatedAt)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
