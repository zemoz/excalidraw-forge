# Excalidraw Forge

Self-host [Excalidraw](https://github.com/excalidraw/excalidraw) in one Docker
image, with end-to-end encrypted real-time collaboration and optional Postgres
persistence.

```bash
docker run -d -p 3000:3000 zemoz/excalidraw-forge
```

Open `http://localhost:3000`. Drawings live in memory and are lost on
restart — fine for trying it out. For anything you want to keep, see
**Persistence** below.

## Collaborate

Click **Share** in the top-right, then hover the button → **Copy**
the share link. Anyone with the link sees your cursor and edits in real time.
Pasted images sync too.

The room ID and AES-GCM key live in the URL hash and are never sent to the
server. The server is a **blind relay**: it forwards opaque encrypted blobs
between peers and stores them on disk (or in memory) without ever being able
to decrypt them. Anyone with the share link can join and decrypt — so treat
the link as the password.

## Persistence (Postgres)

Set `DATABASE_URL` and the app stores everything in Postgres instead of
memory. Tables are created automatically on first run.

```yaml
# docker-compose.yml
services:
  app:
    image: zemoz/excalidraw-forge:latest
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://forge:secret@db:5432/forge
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: forge
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: forge
    volumes:
      - forge-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U forge"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  forge-db:
```

```bash
docker compose up -d
```

The encrypted-blob trust model is unchanged — the Postgres operator can't
read drawings either.

## Configuration

| Env var        | Default | Purpose                                                  |
| -------------- | ------- | -------------------------------------------------------- |
| `PORT`         | `3000`  | HTTP/WebSocket port the server binds to.                 |
| `DATABASE_URL` | *(unset)* | Postgres connection string. Unset → in-memory store.   |

## Develop

```bash
npm install
npm run dev   # http://localhost:3000 — Express + Vite middleware + Socket.io
```

## Credits

Built on [`@excalidraw/excalidraw`](https://www.npmjs.com/package/@excalidraw/excalidraw).
Collaboration protocol ported from upstream
[excalidraw-app](https://github.com/excalidraw/excalidraw/tree/master/excalidraw-app),
so the wire format is compatible.
