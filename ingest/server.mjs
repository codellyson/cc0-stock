#!/usr/bin/env node
// HTTP service variant of the ingest CLI. Stays up, answers health checks, and runs an
// ingest on demand when you POST /run. Same logic as the CLI (core.mjs).
//
//   GET  /health         -> 200 { ok: true }   (also GET /)
//   POST /run            -> runs one ingest, returns the summary JSON
//        Authorization: Bearer <INGEST_SECRET>
//        body: { "q": "...", "source": "both", "pages": 3, "pageSize": 20,
//                "maxDistance": 8, "concurrency": 4, "timeout": 45000 }
//
// Env: PORT (default 8080) + the same vars the CLI uses.

import { createServer } from "node:http";
import { clampInt, loadConfig, resolveSources, runIngest } from "./core.mjs";

const PORT = clampInt(process.env.PORT, 8080, 1, 65535);
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

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      return send(res, 200, { ok: true, service: "cc0-stock-ingest" });
    }

    if (req.method === "POST" && req.url === "/run") {
      if (!config.secret) return send(res, 500, { error: "INGEST_SECRET not set" });
      if (req.headers.authorization !== `Bearer ${config.secret}`) {
        return send(res, 401, { error: "unauthorized" });
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.q) return send(res, 400, { error: "q is required" });

      const sources = resolveSources(body.source);
      if (!sources) return send(res, 400, { error: "source must be openverse | wikimedia | both" });

      const params = {
        q: body.q,
        sources,
        pages: clampInt(body.pages, 1, 1, 5),
        pageSize: clampInt(body.pageSize, 20, 1, 50),
        maxDistance: clampInt(body.maxDistance, 8, 0, 30),
        concurrency: clampInt(body.concurrency, 4, 1, 20),
        timeoutMs: clampInt(body.timeout, 45000, 1000, 300000),
      };

      const summary = await runIngest(params, config);
      return send(res, 200, summary);
    }

    send(res, 404, { error: "not_found" });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`cc0-stock ingest server listening on :${PORT}`));
