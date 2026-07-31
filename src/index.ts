import type { Env } from "./types";
import { GALLERY_HTML } from "./gallery";
import { DOCS_HTML, HOME_HTML } from "./site";
import { handleMcp } from "./mcp";
import {
  createJob,
  getHashes,
  getImageById,
  insertRecord,
  listJobs,
  queryImages,
  toRecord,
  updateJob,
  type JobInput,
  type StorePayload,
} from "./store";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Agent-facing MCP endpoint (stateless JSON-RPC over HTTP, no Durable Object).
    if (path === "/mcp" || path.startsWith("/mcp/")) {
      return handleMcp(request, env, url);
    }

    try {
      if (request.method === "GET" && path === "/search") {
        return await handleSearch(env, url);
      }
      if (request.method === "GET" && path.startsWith("/images/")) {
        return await handleGetImage(env, url, decodeURIComponent(path.slice("/images/".length)));
      }
      if (request.method === "GET" && path.startsWith("/file/")) {
        return await handleServeFile(env, decodeURIComponent(path.slice("/file/".length)));
      }
      if (request.method === "GET" && path === "/hashes") {
        return await handleHashes(request, env);
      }
      if (request.method === "POST" && path === "/store") {
        return await handleStore(request, env);
      }
      if (request.method === "POST" && path === "/jobs") {
        return await handleCreateJob(request, env);
      }
      if (request.method === "PATCH" && path.startsWith("/jobs/")) {
        return await handleUpdateJob(request, env, decodeURIComponent(path.slice("/jobs/".length)));
      }
      if (request.method === "GET" && path === "/jobs") {
        return await handleListJobs(request, env, url);
      }
      // Host-aware root: the api.* domain returns the JSON index; the website domain
      // returns the landing page. Both domains still serve every data route below.
      const isApiHost = url.hostname.startsWith("api.");
      if (path === "/gallery") return html(GALLERY_HTML);
      if (path === "/docs") return html(DOCS_HTML);
      if (path === "/") {
        return isApiHost ? apiIndex() : html(HOME_HTML);
      }
      if (path === "/api") return apiIndex();
      return json({ error: "not_found" }, 404);
    } catch (err) {
      return json({ error: "internal", message: (err as Error).message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleSearch(env: Env, url: URL): Promise<Response> {
  const q = url.searchParams.get("q")?.trim() || undefined;
  const job = url.searchParams.get("job")?.trim() || undefined;
  const perPage = clamp(int(url.searchParams.get("per_page"), 20), 1, 100);
  const page = Math.max(1, int(url.searchParams.get("page"), 1));

  const rows = await queryImages(env, { q, job, page, perPage });
  const results = rows.map((r) => toRecord(r, url.origin));
  return json({ query: q ?? null, page, per_page: perPage, count: results.length, results });
}

async function handleGetImage(env: Env, url: URL, id: string): Promise<Response> {
  const row = await getImageById(env, id);
  if (!row) return json({ error: "not_found" }, 404);
  return json(toRecord(row, url.origin));
}

async function handleServeFile(env: Env, key: string): Promise<Response> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return json({ error: "not_found" }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

async function handleHashes(request: Request, env: Env): Promise<Response> {
  const unauth = requireAuth(request, env);
  if (unauth) return unauth;
  return json(await getHashes(env));
}

async function handleStore(request: Request, env: Env): Promise<Response> {
  const unauth = requireAuth(request, env);
  if (unauth) return unauth;

  const p = (await request.json().catch(() => null)) as StorePayload | null;
  if (!p || !p.id || !p.provider || !p.providerId || !p.sha256 || !p.r2_key) {
    return json({ error: "bad_request", message: "missing required fields" }, 400);
  }

  const result = await insertRecord(env, p);
  return json(result);
}

async function handleCreateJob(request: Request, env: Env): Promise<Response> {
  const unauth = requireAuth(request, env);
  if (unauth) return unauth;
  const j = (await request.json().catch(() => null)) as JobInput | null;
  if (!j || !j.id || !j.query || !j.source) {
    return json({ error: "bad_request", message: "id, query, source required" }, 400);
  }
  await createJob(env, { id: j.id, query: j.query, source: j.source, pages: j.pages ?? 0, status: j.status ?? "running" });
  return json({ ok: true, id: j.id });
}

async function handleUpdateJob(request: Request, env: Env, id: string): Promise<Response> {
  const unauth = requireAuth(request, env);
  if (unauth) return unauth;
  const patch = (await request.json().catch(() => null)) as {
    status?: string;
    summary?: string;
    error?: string;
    finished_at?: string;
  } | null;
  if (!patch) return json({ error: "bad_request" }, 400);
  await updateJob(env, id, patch);
  return json({ ok: true });
}

async function handleListJobs(request: Request, env: Env, url: URL): Promise<Response> {
  const unauth = requireAuth(request, env);
  if (unauth) return unauth;
  const limit = clamp(int(url.searchParams.get("limit"), 50), 1, 200);
  return json(await listJobs(env, limit));
}

// --- helpers ---------------------------------------------------------------

function requireAuth(request: Request, env: Env): Response | null {
  if (!env.INGEST_SECRET) {
    return json({ error: "misconfigured", message: "INGEST_SECRET is not set" }, 500);
  }
  if (request.headers.get("authorization") !== `Bearer ${env.INGEST_SECRET}`) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

function int(v: string | number | null | undefined, fallback: number): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function apiIndex(): Response {
  return json({
    service: "cc0-stock",
    endpoints: {
      "GET /search?q=&page=&per_page=": "keyword search, returns image records",
      "GET /images/:id": "single image record",
      "GET /file/:key": "raw image bytes from R2",
      "ALL /mcp": "MCP server for agents (search_images, get_image)",
      "GET /hashes": "admin: existing id/sha256/phash for dedup (Bearer INGEST_SECRET)",
      "POST /store": "admin: store one prepared record (Bearer INGEST_SECRET)",
    },
    website: "https://cc0-stock.kreativekorna.com",
  });
}
