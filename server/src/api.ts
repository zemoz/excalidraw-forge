import { Router, type Request, type Response } from "express";

import type {
  FileBlobRequest,
  FileBlobResponse,
  SceneSnapshotPutResponse,
  SceneSnapshotRequest,
  SceneSnapshotResponse,
} from "@shared/http";

import type { RoomStore } from "./storage";

// REST API for encrypted scene + file blobs. The server holds opaque
// ciphertext + IV per room/file; it never decrypts anything.
export const createApiRouter = (store: RoomStore): Router => {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ---- Scene snapshots ----------------------------------------------------

  router.get(
    "/rooms/:roomId/scene",
    async (req: Request, res: Response) => {
      const scene = await store.getScene(req.params.roomId);
      if (!scene) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const body: SceneSnapshotResponse = {
        iv: scene.iv.toString("base64"),
        ciphertext: scene.ciphertext.toString("base64"),
        sceneVersion: scene.sceneVersion,
        updatedAt: scene.updatedAt,
      };
      res.json(body);
    },
  );

  router.put(
    "/rooms/:roomId/scene",
    async (req: Request, res: Response) => {
      const { iv, ciphertext, sceneVersion } =
        (req.body ?? {}) as Partial<SceneSnapshotRequest>;
      if (
        typeof iv !== "string" ||
        typeof ciphertext !== "string" ||
        typeof sceneVersion !== "number" ||
        !Number.isFinite(sceneVersion)
      ) {
        res.status(400).json({ error: "invalid_payload" });
        return;
      }

      const stored = await store.saveScene(req.params.roomId, {
        iv: Buffer.from(iv, "base64"),
        ciphertext: Buffer.from(ciphertext, "base64"),
        sceneVersion,
        updatedAt: Date.now(),
      });

      const body: SceneSnapshotPutResponse = {
        accepted: stored.sceneVersion === sceneVersion,
        sceneVersion: stored.sceneVersion,
      };
      res.json(body);
    },
  );

  // ---- Per-file encrypted blobs ------------------------------------------

  router.get(
    "/rooms/:roomId/files/:fileId",
    async (req: Request, res: Response) => {
      const file = await store.getFile(req.params.roomId, req.params.fileId);
      if (!file) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const body: FileBlobResponse = {
        iv: file.iv.toString("base64"),
        ciphertext: file.ciphertext.toString("base64"),
        updatedAt: file.updatedAt,
      };
      res.json(body);
    },
  );

  router.put(
    "/rooms/:roomId/files/:fileId",
    async (req: Request, res: Response) => {
      const { iv, ciphertext } =
        (req.body ?? {}) as Partial<FileBlobRequest>;
      if (typeof iv !== "string" || typeof ciphertext !== "string") {
        res.status(400).json({ error: "invalid_payload" });
        return;
      }
      await store.saveFile(req.params.roomId, req.params.fileId, {
        iv: Buffer.from(iv, "base64"),
        ciphertext: Buffer.from(ciphertext, "base64"),
        updatedAt: Date.now(),
      });
      res.json({ ok: true });
    },
  );

  return router;
};
