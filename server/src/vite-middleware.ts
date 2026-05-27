import path from "path";
import { fileURLToPath } from "url";
import type { Server as HttpServer } from "http";
import type { Application } from "express";

// Mounts the Vite dev server as Express middleware. Imported dynamically so
// Vite stays out of the production bundle. HMR shares `httpServer` so its
// WebSocket lives on the same port as Socket.io and the API.
export const mountViteMiddleware = async (
  app: Application,
  httpServer: HttpServer,
): Promise<void> => {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );

  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    // Explicit configFile so we pick up the alias / fs.allow / etc. from the
    // project's vite.config.ts. (Vite's default search is relative to `root`,
    // which is client/ — the config lives one level up.)
    configFile: path.join(projectRoot, "vite.config.ts"),
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
};
