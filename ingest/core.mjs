// Shared ingestion core, used by both the CLI (ingest.mjs) and the HTTP service
// (server.mjs). Fetches CC0 sources, downloads + hashes + dedups locally, and pushes
// finished records to the Worker (direct-R2 upload when creds are set, else base64).

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

export function clampInt(v, dflt, min, max) {
  const n = parseInt(v ?? "", 10);
  const x = Number.isFinite(n) ? n : dflt;
  return Math.min(max, Math.max(min, x));
}

export function resolveSources(source) {
  const s = (source ?? "both").toLowerCase();
  const arr = s === "both" || s === "all" ? ["openverse", "wikimedia"] : [s];
  return arr.every((x) => x === "openverse" || x === "wikimedia") ? arr : null;
}

export function loadConfig(env = process.env) {
  return {
    workerUrl: (env.WORKER_URL ?? "").replace(/\/$/, ""),
    secret: env.INGEST_SECRET ?? "",
    r2: {
      accountId: env.R2_ACCOUNT_ID ?? "",
      accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
      bucket: env.R2_BUCKET ?? "cc0-stock",
    },
  };
}

export async function runIngest(params, config) {
  const { q, sources, pages, pageSize, maxDistance, concurrency, timeoutMs } = params;
  const { workerUrl, secret, r2 } = config;
  if (!workerUrl) throw new Error("WORKER_URL is required");
  if (!secret) throw new Error("INGEST_SECRET is required");

  const auth = { authorization: `Bearer ${secret}` };
  const directR2 = Boolean(r2 && r2.accountId && r2.accessKeyId && r2.secretAccessKey);
  const r2Client = directR2
    ? new AwsClient({ accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey, region: "auto", service: "s3" })
    : null;
  const r2Endpoint = directR2 ? `https://${r2.accountId}.r2.cloudflarestorage.com` : "";

  async function r2Put(key, buf, mime) {
    const res = await r2Client.fetch(`${r2Endpoint}/${r2.bucket}/${key}`, {
      method: "PUT",
      body: buf,
      headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${await res.text()}`);
  }

  async function loadSeen() {
    const res = await fetch(`${workerUrl}/hashes`, { headers: auth, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`GET /hashes failed: ${res.status} ${await res.text()}`);
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
              ? await wikimediaSearch({ q, page, pageSize })
              : await openverseSearch({ q, page, pageSize });
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
    const res = await fetch(`${workerUrl}/store`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`/store ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function pool(items, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    });
    await Promise.all(runners);
  }

  const summary = {
    query: q,
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

      // atomic near-dup check + reserve (no await inside this block)
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
          ...(directR2 ? {} : { image_base64: buf.toString("base64") }),
        });
      } catch (err) {
        seen.shas.delete(sha256);
        if (ph !== null) {
          const i = seen.phashes.indexOf(ph);
          if (i !== -1) seen.phashes.splice(i, 1);
        }
        throw err;
      }

      if (result.stored) summary.stored++;
      else summary.skipped_duplicate++;
    } catch (err) {
      summary.failed++;
      summary.errors.push(`${id}: ${err.name === "TimeoutError" ? "timeout" : err.message}`);
    }
  });

  return summary;
}
