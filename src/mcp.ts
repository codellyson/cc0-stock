import type { Env } from "./types";
import { getImageById, queryImages, toRecord } from "./store";

// Stateless MCP server over plain HTTP (no Durable Object, no sessions). Our tools are
// self-contained, so we don't need the stateful Streamable-HTTP transport — each POST is
// a complete JSON-RPC exchange answered with application/json.

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "search_images",
    description:
      "Search the CC0 stock image library by keyword. Returns image records each with a " +
      "directly fetchable image_url, license, dimensions, and tags. All results are CC0 / " +
      "public-domain: free to use commercially, no attribution required.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords, e.g. 'mountain lake sunset'" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "Max results" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_image",
    description:
      "Fetch a single CC0 stock image record by id, including image_url and license / " +
      "provenance metadata.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The image id returned by search_images" } },
      required: ["id"],
    },
  },
];

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
};

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

export async function handleMcp(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Stateless: no server-initiated SSE stream (GET) and no session to terminate (DELETE).
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }

  let body: Rpc | Rpc[];
  try {
    body = (await request.json()) as Rpc | Rpc[];
  } catch {
    return rpc(rpcError(null, -32700, "Parse error"));
  }

  const base = env.PUBLIC_BASE_URL || url.origin;

  if (Array.isArray(body)) {
    const requests = body.filter((m) => m && m.id !== undefined);
    if (!requests.length) return new Response(null, { status: 202, headers: CORS });
    const responses = await Promise.all(requests.map((m) => dispatch(m, env, base)));
    return rpc(responses);
  }

  // A notification (method, no id) gets acknowledged with no body.
  if (body && body.method && body.id === undefined) {
    return new Response(null, { status: 202, headers: CORS });
  }

  return rpc(await dispatch(body, env, base));
}

async function dispatch(msg: Rpc, env: Env, base: string): Promise<object> {
  const { id, method, params } = msg ?? {};
  try {
    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: (params?.protocolVersion as string) || PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "cc0-stock", version: "0.1.0" },
        });
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: TOOLS });
      case "tools/call":
        return ok(id, await callTool(params ?? {}, env, base));
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return rpcError(id, -32603, (e as Error).message);
  }
}

async function callTool(params: Record<string, unknown>, env: Env, base: string): Promise<object> {
  const name = params.name as string;
  const args = (params.arguments as Record<string, unknown>) ?? {};

  if (name === "search_images") {
    const limit = clampInt(args.limit, 20, 1, 50);
    const rows = await queryImages(env, { q: String(args.query ?? ""), page: 1, perPage: limit });
    const results = rows.map((r) => toRecord(r, base));
    return {
      content: [{ type: "text", text: JSON.stringify({ count: results.length, results }, null, 2) }],
    };
  }
  if (name === "get_image") {
    const row = await getImageById(env, String(args.id ?? ""));
    if (!row) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "not_found", id: args.id }) }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(toRecord(row, base), null, 2) }] };
  }
  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
}

function ok(id: unknown, result: object) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
function rpc(obj: object) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}
function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = parseInt(String(v ?? ""), 10);
  const x = Number.isFinite(n) ? n : dflt;
  return Math.min(max, Math.max(min, x));
}
