# Agent guide

Brief for AI agents working on this repo. For a user-facing introduction see
[README.md](README.md).

## What this is

**Excalidraw Forge** — self-hosted Excalidraw with end-to-end-encrypted
real-time collaboration. One Node process hosts the React SPA (Vite middleware
in dev, static `dist/client/` in prod), the REST API, and Socket.io. The
server is a **blind relay** and a **dumb encrypted-blob store**; it cannot
decrypt drawing content.

## Layout

```
client/src/         React app (Vite root is client/, not project root)
client/src/collab/  Collab feature — useCollab hook, transport, crypto
server/src/         Node entry, Express app, API routes, Socket.io, store
shared/src/         Wire-protocol constants + REST envelope types (used by both)
```

Path aliases: `@shared/*`, `@client/*`, `@server/*`. Use them — don't write
`../../shared/src/...`.

## Conventions

- **Kebab-case filenames** everywhere. Classes still exported as PascalCase
  (e.g. `collab-session.ts` exports `CollabSession`).
- **Barrel re-exports** for feature folders: import `useCollab` from
  `./collab`, not from `./collab/use-collab`. App.tsx should not reach into
  the internals.
- **`shared/` is runtime-agnostic** — no `@excalidraw/excalidraw` imports, no
  `window`, no `Buffer`. Just plain types and string constants.
- Filenames use kebab-case; React components inside `.tsx` files stay
  PascalCase. CSS file is `index.css`, plain global resets — no CSS modules.
- Prefer hooks + classes over deeply nested component trees. The collab
  feature is a class (`CollabSession`) wrapped in a hook (`useCollab`).

## Commands

```bash
npm run dev         # One server on :3000 (Express + Vite middleware + Socket.io)
npm run typecheck   # All four tsconfigs (shared, client, server, node)
npm run build       # typecheck + Vite SPA build → dist/client/
npm start           # Same Express in --prod mode (serves dist/client/ static)
```

Type-checking uses **four independent tsconfigs**, not `tsc -b` with project
references (that fought `noEmit`). Each tsc -p call includes whatever sources
it needs (`shared/src` is included into both client and server).

## Important gotchas

1. **Excalidraw can't be SSR'd.** It touches `window`/`document`/`canvas` at
   module-evaluation time. The app is client-only; the server delivers an
   HTML shell and hydrates in the browser.

2. **Vite's `root` is `client/`.** Anything outside (notably `shared/`) needs
   `server.fs.allow` to include the project root, otherwise the dev server
   refuses to serve it. Already configured in `vite.config.ts`.

3. **`createViteServer` in middleware mode does NOT auto-find
   `vite.config.ts`** when the config lives outside `root`. We pass
   `configFile` explicitly in `server/src/vite-middleware.ts`. Don't remove
   that.

4. **The wire protocol is shared with the upstream Excalidraw client.** Event
   names (`server-broadcast`, `client-broadcast`, `init-room`, …) live in
   `@shared/protocol`. Don't rename them — they're the public contract that
   makes interop possible (a stock Excalidraw client could in principle talk
   to this server).

5. **Image files must upload BEFORE the scene broadcast.** Peers that fetch
   the file after seeing the image element would 404 otherwise. The
   `CollabSession.syncElements` flow awaits `uploadNewFiles` before calling
   `portal.broadcastScene`. Don't reorder this.

6. **`collaborators` is reference-compared by Excalidraw.** Always pass a
   *new* `Map` to `updateScene({ collaborators })`, never mutate in place.
   `CollabSession.handleMouseLocation` rebuilds the Map on every cursor tick
   for this reason.

7. **`Portal.emit` re-checks `this.socket` after `await`.** `close()` can
   null it mid-encryption — without the re-check you get a `null.emit`
   crash on disconnect.

8. **The auto-start `useEffect` runs once via `apiReadyTick`.** Don't
   simplify the dependency away — without it, a manual click followed by a
   re-render would double-start collab and crash the just-replaced portal.

9. **The reconciliation expects branded `RemoteExcalidrawElement[]`.**
   `collab-session.ts` has a one-line `asRemote` cast — leave it; the brand
   exists only to keep TS callers honest, no runtime difference.

10. **Server has zero auth.** Anyone with the room link can join and (via
    the key in the hash) decrypt. Matches upstream Excalidraw's model. Don't
    add accounts/ACL without a discussion — that's a product decision.

## Storage seam

`server/src/storage/` holds the `RoomStore` interface plus two implementations:

- `in-memory.ts` — process-local Map, default.
- `postgres.ts` — `pg`-backed, auto-creates tables (`scenes` + `files`) on
  startup, last-writer-wins on `sceneVersion` via `INSERT ... ON CONFLICT
  ... WHERE ... < EXCLUDED`.

`createRoomStore()` in `storage/index.ts` picks Postgres if `DATABASE_URL`
is set, otherwise in-memory. The factory is `async` (Postgres needs schema
init), so `server/src/index.ts` `await`s it before building the Express app.

Routes get the store via constructor injection (`createApiRouter(store)`,
`createApp(store)`) — no top-level singleton, no implicit globals. To add a
third backend (Redis, SQLite, etc.) implement `RoomStore` and extend the
factory; nothing else changes.

## What NOT to do

- Don't add new build steps for the server. We use `tsx` directly, no
  compile step. Production runs `tsx server/src/index.ts --prod`.
- Don't introduce npm workspaces. The single-package layout with path
  aliases is intentional.
- Don't add Excalidraw imports to `shared/` or `server/`. Keep the
  client-only blast radius.
- Don't reintroduce a separate dev port for Vite. The whole point of the
  one-process architecture is shared port + HMR over the same HTTP server.

## When verifying changes

Always run after a meaningful edit:

```bash
npm run typecheck         # fast, catches most regressions
npm run build             # also catches Vite-specific issues
npm run dev               # smoke test the actual server
```

For UI/collab changes: open two browser windows on `http://localhost:3000`,
click **Live collaboration** in one, paste the shared link into the other,
verify cursors + edits sync both ways. The browser must actually load — type
errors alone don't tell you Excalidraw mounts.
