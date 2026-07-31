# cc0-stock

A **CC0 / public-domain** image library for agents. Ingest from
[Openverse](https://openverse.org) and [Wikimedia Commons](https://commons.wikimedia.org)
into your own R2 bucket + D1 index, and serve it through a JSON search API **and an MCP
server**.

Why CC0: unlike custom-licensed "free stock" sites (Pexels, Pixabay, Unsplash, Pixnio),
CC0 / public-domain works may legally be **re-hosted and redistributed** — exactly what
re-serving from your own library to agents requires. Both sources are filtered hard to
`cc0`/`pdm`; everything else (CC-BY, CC-BY-SA) is rejected.

## Architecture — two pieces

Ingestion is deliberately **off-Worker** so Cloudflare stays on the free tier (no Queue,
no paid plan) and the CPU-heavy image work never hits a Worker's limits.

```
                    ┌──────── VPS / any machine (ingest/ CLI) ────────┐
Openverse API ─┐    │ fetch → download → sha256 + dHash → dedup        │
Wikimedia API ─┴───►│ (native sharp, fast, no CPU cap)                 │
                    └───────────────┬─────────────────────────────────┘
                       GET /hashes  │  POST /store  (Bearer INGEST_SECRET)
                                    ▼
                          ┌──── Cloudflare Worker (serve + thin store) ────┐
                          │  R2 (image bytes)   D1 (metadata + FTS index)  │
                          └───────────────┬────────────────────────────────┘
   agent (HTTP) ──► GET /search ──► records + image_url ──► GET /file/:key ─┘
   agent (MCP)  ──► /mcp  (search_images, get_image tools)
```

- **Worker** (`src/`) — serving + two thin admin endpoints. Does **no** image decoding,
  so it's tiny and free-tier friendly.
- **Ingest CLI** (`ingest/`) — a Node program you run on your VPS (or locally/cron). Does
  all the heavy lifting, then pushes finished records to the Worker.

## Worker HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Browse gallery (HTML) — search + image grid, public. |
| GET | `/search?q=&page=&per_page=` | Keyword search (FTS5). Returns image records. |
| GET | `/images/:id` | Single record by id. |
| GET | `/file/:key` | Raw image bytes from R2. |
| GET | `/hashes` | Admin: existing id/sha256/phash for dedup. `Bearer INGEST_SECRET`. |
| POST | `/store` | Admin: store one prepared record. `Bearer INGEST_SECRET`. |

**MCP server** (`/mcp`, stateless JSON-RPC over HTTP — no Durable Object): tools `search_images(query, limit)` and
`get_image(id)`. Every record carries `license`; CC0 clears copyright, not a recognizable
person's publicity rights or trademarks — `provenance_url` is kept so images can be vetted.

## Labelling & dedup (in the CLI)

**Labelling** (`ingest/labels.mjs`): license normalized to exact `cc0`/`pdm`; tags cleaned,
lowercased, deduped, and denoised (drops license/maintenance/date categories, pure numbers,
years, camera/EXIF junk) with a title fallback so labels are never empty; each row records
`tag_source`. Descriptions HTML-stripped; `attribution` + `provenance_url` preserved.

**Dedup** — three layers, cheapest first:
1. **By id** (`<provider>:<providerId>`) → `skipped_existing`.
2. **By bytes** (SHA-256) → `skipped_duplicate`.
3. **By look** (perceptual dHash, `ingest/phash.mjs` via `sharp`) — rejects images within
   `--maxDistance` Hamming bits of an existing one (default 8; a 1600→640px resize is ~5
   bits, a different photo ~33). → `skipped_near_duplicate`.

The CLI preloads existing hashes once via `GET /hashes` and dedups in memory. (Scale note:
that's O(n) per image; for millions add an LSH band index.)

## Setup — Worker

```bash
pnpm install
pnpm exec wrangler login
pnpm exec wrangler r2 bucket create cc0-stock
pnpm exec wrangler d1 create cc0-stock   # paste the id into wrangler.jsonc
pnpm run db:init && pnpm run db:init:remote
pnpm exec wrangler secret put INGEST_SECRET
pnpm run deploy                          # note the printed URL
```

Set `PUBLIC_BASE_URL` in `wrangler.jsonc` to that URL and `pnpm run deploy` again so MCP
responses return absolute image URLs.

## Setup — Ingest CLI (on your VPS)

```bash
cd ingest
pnpm install                 # installs sharp (native decode) + aws4fetch (R2 upload)
cp .env.example .env         # fill in WORKER_URL + INGEST_SECRET (+ R2 creds, below)
```

**Direct-R2 upload (recommended — the big speed win).** By default the CLI auto-detects
its mode: if R2 S3 credentials are set it uploads image bytes **straight to R2** and sends
metadata-only to `/store`; otherwise it falls back to base64-through-Worker. The run
summary reports which (`"mode": "direct-r2"` vs `"base64-via-worker"`). To enable direct:

1. Cloudflare dashboard → **R2 → Manage R2 API Tokens → Create API Token** → permission
   **Object Read & Write**, scoped to bucket `cc0-stock`.
2. Put the resulting values in `ingest/.env`:
   `R2_ACCOUNT_ID` (prefilled), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=cc0-stock`.

The Worker HEAD-checks the object before inserting, so a row never points at a missing file.

Run it (reads env from your shell; use a tool like dotenv/direnv or export them):

```bash
export WORKER_URL="https://cc0-stock.<subdomain>.workers.dev"
export INGEST_SECRET="<the production secret>"

node ingest.mjs --q "mountain lake" --source both --pages 2 --pageSize 20
```

Flags: `--q` (required), `--source` (`openverse`|`wikimedia`|`both`, default both),
`--pages`, `--pageSize`, `--maxDistance` (near-dup threshold, default 8),
`--concurrency` (parallel downloads, default 4), `--timeout` (per-request ms, default
45000). Prints a summary: `{ fetched, stored, skipped_*, failed, errors }`. Downloads run
in a bounded pool; near-dup dedup stays correct under concurrency (atomic check-and-reserve).

Schedule regular backfills with cron, e.g.:

```cron
0 3 * * * cd /srv/cc0-stock/ingest && WORKER_URL=... INGEST_SECRET=... node ingest.mjs --q "landscape" --pages 3 >> ingest.log 2>&1
```

Optional: `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET` for higher Openverse rate
limits (register at `POST https://api.openverse.org/v1/auth_tokens/register/`).

## Connecting an agent to the MCP server

```bash
claude mcp add --transport http cc0-stock https://cc0-stock.<subdomain>.workers.dev/mcp
```

Or in an MCP client config:

```jsonc
{ "mcpServers": { "cc0-stock": { "type": "http", "url": "https://cc0-stock.<subdomain>.workers.dev/mcp" } } }
```

The `/mcp` endpoint is unauthenticated (fine for a public read-only CC0 catalog). To lock
it down, front it with `@cloudflare/workers-oauth-provider`.

## Cost

Designed to sit on Cloudflare's **free tier**: Workers requests, D1, and R2 all have free
allowances, and R2 has no egress fees. No Queue and no Durable Objects at all (the MCP
server is stateless plain HTTP), so nothing forces a paid plan. The only always-on compute
— the ingest service — runs on hardware you already own. Watch R2 storage as the library
grows; that's the main thing that scales.

## Next steps worth adding

- LSH band index over `phash` so near-dup lookup scales past ~tens of thousands.
- Skip/timeout oversized originals faster (a few huge Openverse originals hold a pool slot
  for the full `--timeout`); cap max bytes or prefer a smaller source rendition.
- Semantic search (Vectorize), more CC0 sources (museums, NASA/NOAA).
