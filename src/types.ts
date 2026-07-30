export interface Env {
  BUCKET: R2Bucket;
  DB: D1Database;

  // Durable Object namespace backing the MCP server.
  STOCK_MCP: DurableObjectNamespace;

  // Absolute origin of the deployed Worker (e.g. https://cc0-stock.you.workers.dev),
  // used to build fetchable image_url values in MCP tool responses. The HTTP API
  // derives this from the request; MCP tools need it explicitly.
  PUBLIC_BASE_URL?: string;

  // Secret protecting the /store and /hashes endpoints (used by the ingest CLI).
  INGEST_SECRET: string;
}
