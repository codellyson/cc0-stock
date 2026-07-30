import type { Env } from "./types";

/** Sanitize free text into a safe FTS5 MATCH expression with prefix matching. */
export function ftsQuery(q: string): string {
  const terms = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => `${t}*`);
  return terms.join(" OR ");
}

export function safeJsonArray(v: unknown): string[] {
  if (typeof v !== "string") return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function queryImages(
  env: Env,
  opts: { q?: string; page: number; perPage: number }
): Promise<Record<string, unknown>[]> {
  const offset = (opts.page - 1) * opts.perPage;

  let rows: D1Result;
  if (opts.q && opts.q.trim()) {
    const match = ftsQuery(opts.q);
    if (!match) return [];
    rows = await env.DB.prepare(
      `SELECT i.* FROM images_fts f
         JOIN images i ON i.id = f.id
        WHERE images_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?`
    )
      .bind(match, opts.perPage, offset)
      .all();
  } else {
    rows = await env.DB.prepare(`SELECT * FROM images ORDER BY ingested_at DESC LIMIT ? OFFSET ?`)
      .bind(opts.perPage, offset)
      .all();
  }

  return rows.results as Record<string, unknown>[];
}

export async function getImageById(
  env: Env,
  id: string
): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(`SELECT * FROM images WHERE id = ?`).bind(id).first();
  return (row as Record<string, unknown> | null) ?? null;
}

export function toRecord(r: Record<string, unknown>, base: string) {
  return {
    id: r.id,
    provider: r.provider,
    title: r.title,
    description: r.description,
    creator: r.creator,
    attribution: r.attribution,
    source: r.source,
    license: r.license,
    license_version: r.license_version,
    license_url: r.license_url,
    provenance_url: r.provenance_url,
    width: r.width,
    height: r.height,
    mime_type: r.mime_type,
    tags: safeJsonArray(r.tags),
    tag_source: r.tag_source,
    phash: r.phash,
    image_url: `${base}/file/${r.r2_key}`,
  };
}

// --- write side (used by the VPS ingestion CLI via POST /store) ------------

/** The pre-computed record the VPS pushes. All hashing/labelling happens off-Worker;
 *  the Worker only stores. `image_base64` carries the (already resized) image bytes. */
export interface StorePayload {
  id: string; // "<provider>:<providerId>"
  provider: string;
  providerId: string;
  title: string;
  description?: string | null;
  creator?: string | null;
  attribution?: string | null;
  source: string;
  license: string;
  license_version?: string | null;
  license_url: string;
  provenance_url?: string | null;
  origin_url?: string | null;
  width?: number | null;
  height?: number | null;
  mime_type: string;
  sha256: string;
  phash?: string | null;
  tags: string[];
  tag_source: string;
  r2_key: string;
  image_base64?: string; // present only in fallback (base64-through-Worker) mode
}

export async function getHashes(
  env: Env
): Promise<{ id: string; sha256: string; phash: string | null }[]> {
  const rows = await env.DB.prepare("SELECT id, sha256, phash FROM images").all();
  return rows.results as { id: string; sha256: string; phash: string | null }[];
}

export async function insertRecord(
  env: Env,
  p: StorePayload
): Promise<{ stored: boolean; reason?: string }> {
  // DB-side backstop for the VPS's own dedup (exact id / bytes only; near-dup is
  // handled on the VPS where the full phash set lives in memory).
  const existing = await env.DB.prepare("SELECT id FROM images WHERE id = ? OR sha256 = ?")
    .bind(p.id, p.sha256)
    .first();
  if (existing) return { stored: false, reason: "duplicate" };

  const r2Key = p.r2_key;
  if (p.image_base64) {
    // Fallback mode: the Worker receives the bytes and writes them to R2.
    await env.BUCKET.put(r2Key, base64ToBytes(p.image_base64), {
      httpMetadata: { contentType: p.mime_type, cacheControl: "public, max-age=31536000, immutable" },
    });
  } else {
    // Direct mode: the CLI already uploaded to R2 via S3. Verify before inserting so a
    // row never points at a missing object.
    const head = await env.BUCKET.head(r2Key);
    if (!head) return { stored: false, reason: "object_missing" };
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO images
        (id, provider, title, description, creator, attribution, source,
         license, license_version, license_url, provenance_url, origin_url,
         width, height, mime_type, r2_key, sha256, phash, tags, tag_source, ingested_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      p.id,
      p.provider,
      p.title,
      p.description ?? null,
      p.creator ?? null,
      p.attribution ?? null,
      p.source,
      p.license,
      p.license_version ?? null,
      p.license_url,
      p.provenance_url ?? null,
      p.origin_url ?? null,
      p.width ?? null,
      p.height ?? null,
      p.mime_type,
      r2Key,
      p.sha256,
      p.phash ?? null,
      JSON.stringify(p.tags),
      p.tag_source,
      now
    ),
    env.DB.prepare(`INSERT INTO images_fts (id, title, description, tags) VALUES (?,?,?,?)`).bind(
      p.id,
      p.title,
      p.description ?? "",
      p.tags.join(" ")
    ),
  ]);

  return { stored: true };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
