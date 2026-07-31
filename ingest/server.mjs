#!/usr/bin/env node
// HTTP service + dashboard for the ingest CLI. Serves a UI, runs ingests on demand
// (async), and records every job in D1 (via the Worker) so history survives restarts.
//
//   GET  /            -> dashboard UI
//   GET  /health      -> 200 { ok: true }
//   POST /run         -> starts a job, returns { jobId, status:"running" } immediately
//   GET  /jobs        -> recent job history (proxied from the Worker's D1)
//
// Browser endpoints (/run, /jobs) require  Authorization: Bearer <DASHBOARD_TOKEN>.
// The Worker's INGEST_SECRET is used only server-side and never reaches the browser.
//
// Env: PORT (default 8080), DASHBOARD_TOKEN, + the vars core.mjs uses (WORKER_URL,
//      INGEST_SECRET, R2_*, OPENVERSE_*).

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clampInt, loadConfig, resolveSources, runIngest } from "./core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = readFileSync(join(__dirname, "dashboard.html"), "utf8");

const PORT = clampInt(process.env.PORT, 8080, 1, 65535);
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN ?? "";
const config = loadConfig();

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Gate browser-facing endpoints with DASHBOARD_TOKEN (separate from INGEST_SECRET).
function dashAuth(req) {
  if (!DASHBOARD_TOKEN) return { ok: false, code: 500, msg: "DASHBOARD_TOKEN not set on server" };
  if (req.headers.authorization !== `Bearer ${DASHBOARD_TOKEN}`) {
    return { ok: false, code: 401, msg: "unauthorized" };
  }
  return { ok: true };
}

// Server-side calls to the Worker, authed with INGEST_SECRET.
function workerFetch(pathname, method, body) {
  return fetch(`${config.workerUrl}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${config.secret}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(DASHBOARD);
    }

    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true, service: "cc0-stock-ingest" });
    }

    if (req.method === "POST" && req.url === "/run") {
      const auth = dashAuth(req);
      if (!auth.ok) return send(res, auth.code, { error: auth.msg });

      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.q) return send(res, 400, { error: "q is required" });
      const sources = resolveSources(body.source);
      if (!sources) return send(res, 400, { error: "source must be openverse | wikimedia | both" });

      const jobId = randomUUID();
      const params = {
        q: body.q,
        sources,
        pages: clampInt(body.pages, 1, 1, 5),
        pageSize: clampInt(body.pageSize, 20, 1, 50),
        maxDistance: clampInt(body.maxDistance, 8, 0, 30),
        concurrency: clampInt(body.concurrency, 4, 1, 20),
        timeoutMs: clampInt(body.timeout, 45000, 1000, 300000),
        jobId,
      };

      const created = await workerFetch("/jobs", "POST", {
        id: jobId,
        query: body.q,
        source: (body.source ?? "both").toLowerCase(),
        pages: params.pages,
        status: "running",
      });
      if (!created.ok) {
        return send(res, 502, { error: `could not record job: worker ${created.status}` });
      }

      // Run in the background; update the job record on completion. Do NOT await.
      runIngest(params, config)
        .then((summary) =>
          workerFetch(`/jobs/${jobId}`, "PATCH", {
            status: "done",
            summary: JSON.stringify(summary),
            finished_at: new Date().toISOString(),
          })
        )
        .catch((err) =>
          workerFetch(`/jobs/${jobId}`, "PATCH", {
            status: "error",
            error: String(err?.message ?? err),
            finished_at: new Date().toISOString(),
          })
        );

      return send(res, 202, { jobId, status: "running" });
    }

    if (req.method === "GET" && req.url === "/jobs") {
      const auth = dashAuth(req);
      if (!auth.ok) return send(res, auth.code, { error: auth.msg });
      const wr = await workerFetch("/jobs?limit=100", "GET");
      const data = await wr.json().catch(() => []);
      return send(res, wr.status, data);
    }

    // Images stored by a specific job (proxied from the Worker's public /search?job=).
    const imgMatch = req.method === "GET" && req.url.match(/^\/jobs\/([^/]+)\/images$/);
    if (imgMatch) {
      const auth = dashAuth(req);
      if (!auth.ok) return send(res, auth.code, { error: auth.msg });
      const jobId = decodeURIComponent(imgMatch[1]);
      const wr = await fetch(`${config.workerUrl}/search?job=${encodeURIComponent(jobId)}&per_page=100`);
      const data = await wr.json().catch(() => ({ results: [] }));
      return send(res, wr.status, data.results ?? []);
    }

    send(res, 404, { error: "not_found" });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`cc0-stock ingest server + dashboard on :${PORT}`));
