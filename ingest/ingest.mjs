#!/usr/bin/env node
// Off-Worker ingestion CLI (one-shot). See core.mjs for the shared logic and server.mjs
// for the HTTP service variant.
//
// Env:  WORKER_URL, INGEST_SECRET  (required)
//       R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET  (direct-R2)
//       OPENVERSE_CLIENT_ID / OPENVERSE_CLIENT_SECRET  (optional, higher rate limits)
//
// Usage: node ingest.mjs --q "mountain lake" [--source both|openverse|wikimedia]
//                        [--pages 2] [--pageSize 20] [--maxDistance 8]
//                        [--concurrency 4] [--timeout 45000]

import { clampInt, loadConfig, resolveSources, runIngest } from "./core.mjs";

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

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
if (!config.workerUrl) die("WORKER_URL env var is required");
if (!config.secret) die("INGEST_SECRET env var is required");
if (!args.q) die('--q "search terms" is required');

const sources = resolveSources(args.source);
if (!sources) die("--source must be openverse | wikimedia | both");

const params = {
  q: args.q,
  sources,
  pages: clampInt(args.pages, 1, 1, 100),
  pageSize: clampInt(args.pageSize, 20, 1, 100),
  maxDistance: clampInt(args.maxDistance, 8, 0, 30),
  concurrency: clampInt(args.concurrency, 4, 1, 20),
  timeoutMs: clampInt(args.timeout, 45000, 1000, 300000),
};

runIngest(params, config)
  .then((summary) => console.log(JSON.stringify(summary, null, 2)))
  .catch((e) => die(e.stack || e.message));
