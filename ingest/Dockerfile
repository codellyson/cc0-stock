# Portable ingestion image. node:20-slim is Debian/glibc, so sharp installs its prebuilt
# libvips binary with no extra system packages.
FROM node:20-slim

WORKDIR /app
RUN corepack enable

# Install deps first for better layer caching.
COPY package.json ./
RUN pnpm install --prod

COPY . .

# Config comes from the environment (docker run --env-file .env ...).
ENTRYPOINT ["node", "ingest.mjs"]
