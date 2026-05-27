import { createServer } from "http";
import { Server } from "socket.io";

import { createApp, mountStaticSpa } from "./app";
import { mountViteMiddleware } from "./vite-middleware";
import { registerSocketHandlers } from "./socket";
import { createRoomStore } from "./storage";

const PORT = Number(process.env.PORT ?? 3000);
const IS_PROD =
  process.argv.includes("--prod") || process.env.NODE_ENV === "production";

const store = await createRoomStore();
const app = createApp(store);
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 20 * 1024 * 1024,
  transports: ["websocket", "polling"],
});
registerSocketHandlers(io);

// Mount the host-app layer last so /api and the Socket.io upgrade handler
// take precedence on their paths.
if (IS_PROD) {
  mountStaticSpa(app);
} else {
  await mountViteMiddleware(app, httpServer);
}

httpServer.listen(PORT, () => {
  console.log(
    `[server] ${IS_PROD ? "prod" : "dev"} mode — http://localhost:${PORT}`,
  );
});
