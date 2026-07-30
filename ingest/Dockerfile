# Portable ingestion image. node:20-slim is Debian/glibc, so sharp installs its prebuilt
# libvips binary with no extra system packages.
FROM node:20-slim

WORKDIR /app
RUN corepack enable

# Install deps first for better layer caching.
COPY package.json ./
RUN pnpm install --prod

COPY . .

# Default: run the HTTP service (health + POST /run) — this is what a PaaS deploys.
# For a one-shot CLI run instead, override the command:
#   docker run --env-file .env cc0-ingest node ingest.mjs --q "mountain lake" --pages 3
EXPOSE 8080
CMD ["node", "server.mjs"]
