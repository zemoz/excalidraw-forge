import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import express, { type Application } from "express";

import { createApiRouter } from "./api";
import type { RoomStore } from "./storage";

// Builds the Express app and wires up:
//   - JSON parser (image dataURLs can run large, so the limit is generous)
//   - CORS (open by default; restrict via reverse proxy in real deployments)
//   - `/api/*` REST routes
// The host-app layer (Vite middleware in dev, static SPA in prod) is mounted
// separately by the entry, after this returns.
export const createApp = (store: RoomStore): Application => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "30mb" }));
  app.use("/api", createApiRouter(store));
  return app;
};

// In prod, the same Express also serves the built SPA from dist/client/.
// The SPA fallback ensures client-side routing (hash links like #room=...)
// keeps working on deep links.
export const mountStaticSpa = (app: Application): void => {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const clientDir = path.join(projectRoot, "dist/client");
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
};
