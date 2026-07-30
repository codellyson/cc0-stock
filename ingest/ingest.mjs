#!/usr/bin/env node
// Off-Worker ingestion CLI. Fetches CC0 sources, downloads + hashes + dedups locally
// (native sharp — no Worker CPU limit), then pushes finished records to the Worker's
// /store endpoint. Keeps Cloudflare on the free tier: no Queue, no image work on-Worker.
//
// Env:  WORKER_URL   e.g. https://cc0-stock.iamdellyson.workers.dev
//       INGEST_SECRET  the Bearer secret for /store and /hashes
//       OPENVERSE_CLIENT_ID / OPENVERSE_CLIENT_SECRET  (optional, higher rate limits)
//
// Usage: node ingest.mjs --q "mountain lake" [--source both|openverse|wikimedia]
//                        [--pages 2] [--pageSize 20] [--maxDistance 8]
//                        [--concurrency 6] [--timeout 20000]

import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { openverseSearch } from "./sources/openverse.mjs";
import { wikimediaSearch } from "./sources/wikimedia.mjs";
import { dHash, fromHex, hamming, toHex } from "./phash.mjs";

const UA = "cc0-stock-ingest/0.1 (+https://github.com/your-org/cc0-stock)";

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/tiff": "tif",
};
const extFor = (mime) => EXT_BY_MIME[mime] ?? "jpg";

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1];
  }
  return a;
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function clampInt(v, dflt, min, max) {
  const n = parseInt(v ?? "", 10);
  const x = Number.isFinite(n) ? n : dflt;
  return Math.min(max, Math.max(min, x));
}

const args = parseArgs(process.argv.slice(2));
const WORKER_URL = (process.env.WORKER_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.INGEST_SECRET ?? "";
if (!WORKER_URL) die("WORKER_URL env var is required");
if (!SECRET) die("INGEST_SECRET env var is required");
if (!args.q) die('--q "search terms" is required');

const source = (args.source ?? "both").toLowerCase();
const sources = source === "both" || source === "all" ? ["openverse", "wikimedia"] : [source];
if (!sources.every((s) => s === "openverse" || s === "wikimedia")) {
  die("--source must be openverse | wikimedia | both");
}
const pages = clampInt(args.pages, 1, 1, 100);
const pageSize = clampInt(args.pageSize, 20, 1, 100);
const maxDistance = clampInt(args.maxDistance, 8, 0, 30);
// Modest defaults: base64 uploads travel back through the Worker over the user's
// uplink, so too much concurrency or too short a timeout causes spurious timeouts.
const concurrency = clampInt(args.concurrency, 4, 1, 20);
const timeoutMs = clampInt(args.timeout, 45000, 1000, 300000);

const auth = { authorization: `Bearer ${SECRET}` };

// Direct-R2 mode: if S3 creds are present, upload image bytes straight to R2 and send
// metadata-only to /store. Otherwise fall back to base64-through-Worker.
const R2 = {
  accountId: process.env.R2_ACCOUNT_ID ?? "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  bucket: process.env.R2_BUCKET ?? "cc0-stock",
};
const directR2 = Boolean(R2.accountId && R2.accessKeyId && R2.secretAccessKey);
const r2Client = directR2
  ? new AwsClient({ accessKeyId: R2.accessKeyId, secretAccessKey: R2.secretAccessKey, region: "auto", service: "s3" })
  : null;
const r2Endpoint = `https://${R2.accountId}.r2.cloudflarestorage.com`;

async function r2Put(key, buf, mime) {
  const res = await r2Client.fetch(`${r2Endpoint}/${R2.bucket}/${key}`, {
    method: "PUT",
    body: buf,
    headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${await res.text()}`);
}

async function loadSeen() {
  const res = await fetch(`${WORKER_URL}/hashes`, {
    headers: auth,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) die(`GET /hashes failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  const ids = new Set();
  const shas = new Set();
  const phashes = [];
  for (const r of rows) {
    ids.add(r.id);
    shas.add(r.sha256);
    if (r.phash) phashes.push(fromHex(r.phash));
  }
  return { ids, shas, phashes };
}

async function collectItems() {
  const items = [];
  const errors = [];
  for (let page = 1; page <= pages; page++) {
    for (const src of sources) {
      try {
        const fetched =
          src === "wikimedia"
            ? await wikimediaSearch({ q: args.q, page, pageSize })
            : await openverseSearch({ q: args.q, page, pageSize });
        items.push(...fetched);
      } catch (err) {
        errors.push(`${src} p${page}: ${err.message}`);
      }
    }
  }
  return { items, errors };
}

async function download(url) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  return { buf: Buffer.from(await res.arrayBuffer()), mime };
}

async function store(payload) {
  const res = await fetch(`${WORKER_URL}/store`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`/store ${res.status}: ${await res.text()}`);
  return res.json();
}

// Bounded worker pool: at most `concurrency` items in flight at once.
async function pool(items, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function run() {
  const summary = {
    query: args.q,
    sources,
    concurrency,
    mode: directR2 ? "direct-r2" : "base64-via-worker",
    fetched: 0,
    stored: 0,
    skipped_existing: 0,
    skipped_duplicate: 0,
    skipped_near_duplicate: 0,
    failed: 0,
    errors: [],
  };

  const seen = await loadSeen();
  const { items, errors } = await collectItems();
  summary.fetched = items.length;
  summary.errors.push(...errors);

  await pool(items, async (item) => {
    const id = `${item.provider}:${item.providerId}`;
    try {
      // Reserve id early (sync) so the same item on two pages isn't downloaded twice.
      if (seen.ids.has(id)) {
        summary.skipped_existing++;
        return;
      }
      seen.ids.add(id);

      const { buf, mime } = await download(item.downloadUrl);

      const sha256 = createHash("sha256").update(buf).digest("hex");
      if (seen.shas.has(sha256)) {
        summary.skipped_duplicate++;
        return;
      }

      const ph = await dHash(buf);

      // --- atomic near-dup check + reserve (no await inside this block) ---
      if (ph !== null) {
        for (const h of seen.phashes) {
          if (hamming(h, ph) <= maxDistance) {
            summary.skipped_near_duplicate++;
            return;
          }
        }
        seen.phashes.push(ph);
      }
      seen.shas.add(sha256);
      // -------------------------------------------------------------------

      const r2Key = `images/${item.provider}/${item.providerId}.${extFor(mime)}`;
      let result;
      try {
        if (directR2) await r2Put(r2Key, buf, mime);
        result = await store({
          id,
          provider: item.provider,
          providerId: item.providerId,
          title: item.title,
          description: item.description ?? null,
          creator: item.creator ?? null,
          attribution: item.attribution ?? null,
          source: item.source,
          license: item.license,
          license_version: item.licenseVersion ?? null,
          license_url: item.licenseUrl,
          provenance_url: item.provenanceUrl ?? null,
          origin_url: item.downloadUrl,
          width: item.width ?? null,
          height: item.height ?? null,
          mime_type: mime,
          sha256,
          phash: ph === null ? null : toHex(ph),
          tags: item.tags,
          tag_source: item.tagSource,
          r2_key: r2Key,
          // base64 only in fallback mode; in direct mode the bytes are already in R2.
          ...(directR2 ? {} : { image_base64: buf.toString("base64") }),
        });
      } catch (err) {
        // Roll back reservations so a later genuine image isn't wrongly skipped.
        seen.shas.delete(sha256);
        if (ph !== null) {
          const i = seen.phashes.indexOf(ph);
          if (i !== -1) seen.phashes.splice(i, 1);
        }
        throw err;
      }

      if (result.stored) summary.stored++;
      else summary.skipped_duplicate++; // server-side backstop caught it
    } catch (err) {
      summary.failed++;
      summary.errors.push(`${id}: ${err.name === "TimeoutError" ? "timeout" : err.message}`);
    }
  });

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((e) => die(e.stack || e.message));
