// Human-facing website pages served on the website domain: a landing page and MCP docs.
// The gallery lives in gallery.ts. All three share the nav + base styles below.

const API_ORIGIN = "https://api.cc0-stock.kreativekorna.com";

const STYLE = `<style>
  :root { --bg:#f6f7f9; --panel:#fff; --border:#e3e6ea; --text:#1c2024; --muted:#697077;
    --accent:#2f6feb; --accent-fg:#fff; --ok:#1a7f37; --ok-bg:#e6f4ea; --code:#f0f2f5;
    --mono:ui-monospace,SFMono-Regular,Menlo,monospace; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1216; --panel:#171b21; --border:#262c34;
    --text:#e6e9ee; --muted:#8b949e; --accent:#4c8dff; --accent-fg:#08111f; --ok:#3fb950; --ok-bg:#12331c; --code:#12161c; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  a { color:var(--accent); }
  .nav { position:sticky; top:0; z-index:5; background:var(--panel); border-bottom:1px solid var(--border);
    padding:12px 20px; display:flex; align-items:center; gap:20px; }
  .nav .brand { font-weight:700; text-decoration:none; color:var(--text); font-size:16px; }
  .nav nav { display:flex; gap:16px; margin-left:auto; }
  .nav nav a { text-decoration:none; color:var(--muted); font-size:14px; }
  .nav nav a.on, .nav nav a:hover { color:var(--text); }
  main { max-width:820px; margin:0 auto; padding:32px 20px 80px; }
  .hero h1 { font-size:34px; letter-spacing:-0.02em; margin:0 0 10px; }
  .hero p.lede { font-size:18px; color:var(--muted); margin:0 0 22px; }
  .cta { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:36px; }
  .btn { display:inline-block; padding:11px 20px; border-radius:9px; text-decoration:none; font-weight:600; font-size:15px; }
  .btn.primary { background:var(--accent); color:var(--accent-fg); }
  .btn.ghost { border:1px solid var(--border); color:var(--text); }
  h2 { font-size:20px; margin:34px 0 10px; letter-spacing:-0.01em; }
  p { margin:0 0 12px; }
  .muted { color:var(--muted); }
  ul { padding-left:20px; }
  li { margin:5px 0; }
  code { font-family:var(--mono); font-size:13.5px; background:var(--code); padding:2px 6px; border-radius:5px; }
  pre { background:var(--code); border:1px solid var(--border); border-radius:9px; padding:14px 16px; overflow-x:auto; }
  pre code { background:none; padding:0; font-size:13px; line-height:1.55; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:700;
    color:var(--ok); background:var(--ok-bg); text-transform:uppercase; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:11px; padding:18px 20px; margin:14px 0; }
  .tool { font-family:var(--mono); font-weight:700; }
  footer { color:var(--muted); font-size:13px; border-top:1px solid var(--border); margin-top:44px; padding-top:16px; }
</style>`;

function shell(title: string, active: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title>${STYLE}</head>
<body>
<header class="nav">
  <a class="brand" href="/">cc0-stock</a>
  <nav>
    <a href="/"${active === "home" ? ' class="on"' : ""}>Home</a>
    <a href="/gallery"${active === "gallery" ? ' class="on"' : ""}>Gallery</a>
    <a href="/docs"${active === "docs" ? ' class="on"' : ""}>MCP Docs</a>
  </nav>
</header>
<main>${body}</main>
</body></html>`;
}

export const HOME_HTML = shell(
  "cc0-stock — CC0 image library for humans and agents",
  "home",
  `<div class="hero">
    <h1>A CC0 image library for humans <span class="muted">&amp;</span> AI agents</h1>
    <p class="lede">Search and use public-domain images — free for anything, including
    commercial use, with no attribution required.</p>
    <div class="cta">
      <a class="btn primary" href="/gallery">Browse the gallery →</a>
      <a class="btn ghost" href="/docs">Connect an agent (MCP)</a>
    </div>
  </div>

  <h2>What this is</h2>
  <p>cc0-stock ingests <span class="badge">CC0</span> / public-domain images from
  <a href="https://openverse.org">Openverse</a> and
  <a href="https://commons.wikimedia.org">Wikimedia Commons</a>, re-hosts them, and makes
  them searchable — as a website for people and as an <a href="/docs">MCP server</a> for agents.</p>
  <p class="muted">Unlike most "free stock" sites, CC0 works may be legally re-hosted and
  redistributed, which is what makes serving them to agents possible.</p>

  <h2>For agents</h2>
  <p>Connect over MCP and call <code>search_images</code> / <code>get_image</code>. Each
  result includes a directly fetchable image URL. See the <a href="/docs">MCP docs</a>.</p>

  <h2>For developers</h2>
  <p>A plain JSON API lives at <code>${API_ORIGIN}</code>:</p>
  <ul>
    <li><code>GET /search?q=…</code> — keyword search, returns image records</li>
    <li><code>GET /images/:id</code> — a single record</li>
    <li><code>GET /file/:key</code> — the raw image bytes</li>
  </ul>

  <h2>Licensing</h2>
  <p class="muted">Everything is CC0 or public domain — no attribution needed. Note that CC0
  clears <em>copyright</em>, not a recognizable person's publicity rights or trademarks;
  each record keeps a provenance link so images can be vetted before sensitive use.</p>

  <footer>cc0-stock · images sourced from Openverse &amp; Wikimedia Commons under CC0 / public domain</footer>`
);

export const DOCS_HTML = shell(
  "cc0-stock — MCP docs",
  "docs",
  `<div class="hero">
    <h1>MCP server</h1>
    <p class="lede">Give any MCP-capable agent a CC0 image library. Stateless JSON-RPC over
    HTTP — no session, no auth for reads.</p>
  </div>

  <h2>Endpoint</h2>
  <pre><code>${API_ORIGIN}/mcp</code></pre>

  <h2>Connect</h2>
  <p><strong>Claude Code:</strong></p>
  <pre><code>claude mcp add --transport http cc0-stock ${API_ORIGIN}/mcp</code></pre>
  <p><strong>Other MCP clients</strong> — add to the client's config:</p>
  <pre><code>{
  "mcpServers": {
    "cc0-stock": { "type": "http", "url": "${API_ORIGIN}/mcp" }
  }
}</code></pre>

  <h2>Tools</h2>
  <div class="card">
    <p><span class="tool">search_images</span>(query: string, limit?: number)</p>
    <p class="muted">Keyword search. Returns matching CC0 records, each with a fetchable
    <code>image_url</code>, license, dimensions, and tags. <code>limit</code> defaults to 20 (max 50).</p>
  </div>
  <div class="card">
    <p><span class="tool">get_image</span>(id: string)</p>
    <p class="muted">Fetch one record by id, including <code>image_url</code> and license / provenance metadata.</p>
  </div>

  <h2>Example</h2>
  <p>A <code>tools/call</code> for <code>search_images</code> returns text content containing JSON:</p>
  <pre><code>{
  "count": 1,
  "results": [
    {
      "id": "wikimedia:117648128",
      "title": "Lake Mountain Landscape",
      "license": "cc0",
      "width": 1024, "height": 683,
      "tags": ["mountain", "lake", "landscape"],
      "provenance_url": "https://commons.wikimedia.org/…",
      "image_url": "${API_ORIGIN}/file/images/wikimedia/117648128.jpg"
    }
  ]
}</code></pre>

  <h2>Notes</h2>
  <ul>
    <li>All results are CC0 / public domain — free to use commercially, no attribution required.</li>
    <li>CC0 clears copyright, not publicity/trademark rights — vet <code>provenance_url</code> for images of recognizable people or brands.</li>
    <li>The transport is stateless: each request is a complete JSON-RPC exchange, answered as <code>application/json</code>.</li>
  </ul>

  <footer><a href="/">← Home</a> · <a href="/gallery">Gallery</a></footer>`
);
