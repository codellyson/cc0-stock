# Deploying the ingest CLI on a VPS

This folder is self-contained. It ingests CC0 images from Openverse + Wikimedia, dedups,
and pushes them to the cc0-stock Worker. It is a **batch job**, not a server — run it on a
schedule. Two paths below; pick one.

## Config (both paths)

```bash
cp .env.example .env
```

Fill in `.env`:
- `WORKER_URL`, `INGEST_SECRET` — required.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — enable
  direct-R2 upload (recommended, much faster). Without them it falls back to
  base64-through-Worker. Create the token: Cloudflare dashboard → R2 → Manage R2 API
  Tokens → Object Read & Write, bucket `cc0-stock`.
- `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET` — optional, higher rate limits.

Edit `queries.txt` with the search phrases you want to backfill.

---

## Path A — Docker (recommended: portable, bundles sharp)

Requires Docker on the VPS. From this folder:

```bash
docker build -t cc0-ingest .
```

Single query:

```bash
docker run --rm --env-file .env cc0-ingest --q "mountain lake" --pages 3
```

Whole backfill list (`queries.txt`):

```bash
docker run --rm --env-file .env -v "$PWD/queries.txt:/app/queries.txt:ro" \
  --entrypoint sh cc0-ingest run.sh
```

Or via compose: `docker compose run --rm ingest --q "mountain lake" --pages 3`.

**Schedule** with host cron (daily 3am):

```cron
0 3 * * * cd /srv/cc0-stock/ingest && docker run --rm --env-file .env --entrypoint sh cc0-ingest run.sh >> /var/log/cc0-ingest.log 2>&1
```

---

## Path B — Bare Node + systemd (no Docker)

Requires Node ≥ 18.17 and pnpm (`corepack enable`). From this folder:

```bash
pnpm install --prod
chmod +x run.sh
./run.sh                 # runs the whole queries.txt once
```

**Schedule** with the provided systemd units (edit `User` and paths inside them first):

```bash
sudo cp deploy/cc0-ingest.service /etc/systemd/system/
sudo cp deploy/cc0-ingest.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cc0-ingest.timer
```

Check it: `systemctl list-timers cc0-ingest.timer` and `journalctl -u cc0-ingest.service`.

Plain cron alternative:

```cron
0 3 * * * cd /srv/cc0-stock/ingest && ./run.sh >> /var/log/cc0-ingest.log 2>&1
```

---

## Notes

- Each run reports a JSON summary incl. `"mode": "direct-r2" | "base64-via-worker"` — check
  it's `direct-r2` once your R2 creds are set.
- Re-running the same queries is safe: id/byte/perceptual dedup means already-stored images
  are skipped, not duplicated.
- `.env` holds secrets — it's git-ignored and excluded from the Docker image; keep it 0600.
