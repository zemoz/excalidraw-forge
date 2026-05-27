import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Vite roles:
//   - In dev, mounted as Express middleware by server/src/vite-middleware.ts
//     (no standalone dev server — HMR shares the API/Socket.io port).
//   - In prod, builds the SPA to dist/client/ which the same Express server
//     serves statically.
export default defineConfig({
  root: path.join(projectRoot, "client"),
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.join(projectRoot, "shared/src"),
      "@client": path.join(projectRoot, "client/src"),
    },
  },
  build: {
    // Built relative to `root`, so this lands at <projectRoot>/dist/client.
    outDir: path.join(projectRoot, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    // `root` is client/ but the alias points to shared/ which sits above it.
    // Whitelist the whole project root so Vite serves shared/src files.
    fs: {
      allow: [projectRoot],
    },
    watch: {
      ignored: ["**/dist/**"],
    },
  },
});
