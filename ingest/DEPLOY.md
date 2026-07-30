# Deploying the ingest CLI on a VPS / PaaS

This folder ingests CC0 images from Openverse + Wikimedia, dedups, and pushes them to the
cc0-stock Worker. It runs in **two shapes** from the same code:

- **Service** (`server.mjs`) — stays up, answers a health check, runs an ingest on demand
  when you `POST /run`. Use this on a PaaS (justdeploy, Railway, Render, Fly, …).
- **Batch CLI** (`ingest.mjs`) — runs once and exits. Use this on a VPS via cron/systemd.

## Config (both shapes)

```bash
cp .env.example .env
```

Fill in `.env`:
- `WORKER_URL`, `INGEST_SECRET` — required.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — enable
  direct-R2 upload (faster). Without them it falls back to base64-through-Worker.
  Create the token: dashboard → R2 → Manage R2 API Tokens → Object Read & Write, `cc0-stock`.
- `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET` — optional, higher Openverse rate limits.
- `PORT` — service only; most PaaS set this automatically (default 8080).

---

## Shape 1 — Service (PaaS, e.g. justdeploy)

Endpoints:
- `GET /health` (and `GET /`) → `200 { ok: true }` — satisfies the platform health check.
- `POST /run` with `Authorization: Bearer <INGEST_SECRET>` and body
  `{ "q": "...", "source": "both", "pages": 3, "pageSize": 20, "maxDistance": 8 }`
  → runs one ingest, returns the summary JSON.

**On justdeploy / railpack:** set the service **root directory to `ingest/`** so it uses
this `package.json`. railpack runs `pnpm start` → `node server.mjs`, which listens on
`$PORT`. Set the env vars above. The health check passes immediately; trigger ingests with:

```bash
curl -X POST https://<your-service-url>/run \
  -H "authorization: Bearer $INGEST_SECRET" \
  -H "content-type: application/json" \
  -d '{"q":"mountain lake","pages":3}'
```

**On Docker** (the image defaults to the service):

```bash
docker build -t cc0-ingest .
docker run --rm -p 8080:8080 --env-file .env cc0-ingest    # serves on :8080
```

---

## Shape 2 — Batch CLI (VPS cron/systemd)

Single query (Docker — override the default command):

```bash
docker run --rm --env-file .env cc0-ingest node ingest.mjs --q "mountain lake" --pages 3
```

Bare Node (needs Node ≥ 18.17, `corepack enable`):

```bash
pnpm install --prod
node ingest.mjs --q "mountain lake" --pages 3
# or the whole queries.txt list:
chmod +x run.sh && ./run.sh
```

**Schedule** with the provided systemd units (edit `User`/paths inside first):

```bash
sudo cp deploy/cc0-ingest.service deploy/cc0-ingest.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cc0-ingest.timer
```

Plain cron alternative:

```cron
0 3 * * * cd /srv/cc0-stock/ingest && ./run.sh >> /var/log/cc0-ingest.log 2>&1
```

---

## Notes

- Each run reports `"mode": "direct-r2" | "base64-via-worker"` — confirm `direct-r2` once
  your R2 creds are set.
- Re-running the same queries is safe: id/byte/perceptual dedup skips already-stored images.
- `.env` holds secrets — git-ignored and excluded from the Docker image; keep it `0600`.
- `POST /run` is synchronous (returns when the ingest finishes). For a big multi-page run,
  give your client/platform a generous request timeout.
