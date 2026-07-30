import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import type { Env } from "./types";
import { getImageById, queryImages, toRecord } from "./store";

/**
 * MCP server exposing the CC0 stock library as agent-native tools.
 * Served over Streamable HTTP at /mcp (see index.ts). Runs on a Durable Object
 * per the agents SDK; it is stateless here (no per-session state needed).
 */
export class StockMCP extends McpAgent<Env, unknown, Record<string, never>> {
  server = new McpServer({ name: "cc0-stock", version: "0.1.0" });

  async init() {
    const base = this.env.PUBLIC_BASE_URL ?? "";

    this.server.registerTool(
      "search_images",
      {
        description:
          "Search the CC0 stock image library by keyword. Returns image records " +
          "each with a directly fetchable image_url, license, dimensions, and tags. " +
          "All results are CC0 / public-domain: free to use commercially, no attribution required.",
        inputSchema: {
          query: z.string().describe("Keywords, e.g. 'mountain lake sunset'"),
          limit: z.number().int().min(1).max(50).default(20).describe("Max results"),
        },
      },
      async ({ query, limit }) => {
        const rows = await queryImages(this.env, { q: query, page: 1, perPage: limit });
        const results = rows.map((r) => toRecord(r, base));
        return {
          content: [
            { type: "text", text: JSON.stringify({ count: results.length, results }, null, 2) },
          ],
        };
      }
    );

    this.server.registerTool(
      "get_image",
      {
        description:
          "Fetch a single CC0 stock image record by id, including image_url and " +
          "license / provenance metadata.",
        inputSchema: {
          id: z.string().describe("The image id returned by search_images"),
        },
      },
      async ({ id }) => {
        const row = await getImageById(this.env, id);
        if (!row) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "not_found", id }) }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(toRecord(row, base), null, 2) }] };
      }
    );
  }
}
