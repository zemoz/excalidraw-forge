# syntax=docker/dockerfile:1.7

# ------------------------------------------------------------------
# Stage 1: build the SPA. Vite output goes to /app/dist/client.
# Server is not compiled — it runs via tsx at container startup.
# ------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies based on the lockfile only — keeps this layer cached
# until package.json or package-lock.json change.
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Now bring in the rest of the source and build.
COPY tsconfig*.json vite.config.ts ./
COPY shared ./shared
COPY client ./client
COPY server ./server

RUN npm run build

# ------------------------------------------------------------------
# Stage 2: minimal runtime. Installs prod deps only and copies the
# built SPA plus the server source (executed via tsx).
# ------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Server source (tsx runs it directly) + shared types it imports + the
# built SPA the Express server serves statically in --prod mode.
COPY --from=builder /app/dist/client ./dist/client
COPY server ./server
COPY shared ./shared
COPY tsconfig.base.json tsconfig.server.json ./

# Run as the unprivileged `node` user baked into the official image.
USER node

EXPOSE 3000

CMD ["node", "node_modules/.bin/tsx", "server/src/index.ts", "--prod"]
