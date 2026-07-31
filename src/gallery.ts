// Public browse gallery, served by the Worker at "/". Framework-free HTML that queries
// the same-origin /search endpoint and renders results as an image grid.

export const GALLERY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>cc0-stock — CC0 image library</title>
<style>
  :root {
    --bg:#f6f7f9; --panel:#fff; --border:#e3e6ea; --text:#1c2024; --muted:#697077;
    --accent:#2f6feb; --ok:#1a7f37; --ok-bg:#e6f4ea; --mono:ui-monospace,Menlo,monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1216; --panel:#171b21; --border:#262c34; --text:#e6e9ee; --muted:#8b949e;
      --accent:#4c8dff; --ok:#3fb950; --ok-bg:#12331c; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  header { position:sticky; top:0; z-index:5; background:var(--panel); border-bottom:1px solid var(--border);
    padding:12px 20px; display:flex; gap:14px; align-items:center; }
  header .brand { font-size:16px; font-weight:700; color:var(--text); text-decoration:none; white-space:nowrap; }
  header .topnav { display:flex; gap:14px; }
  header .topnav a { font-size:14px; color:var(--muted); text-decoration:none; }
  header .topnav a.on, header .topnav a:hover { color:var(--text); }
  #q { flex:1; max-width:520px; padding:9px 12px; border:1px solid var(--border); border-radius:8px;
    background:var(--bg); color:var(--text); font-size:14px; }
  #q:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  #count { font-size:13px; color:var(--muted); white-space:nowrap; }
  main { padding:18px 20px 60px; max-width:1300px; margin:0 auto; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:14px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:10px; overflow:hidden;
    display:flex; flex-direction:column; }
  .thumb { aspect-ratio:4/3; background:var(--bg); overflow:hidden; display:block; }
  .thumb img { width:100%; height:100%; object-fit:cover; display:block; transition:transform .2s; background:var(--bg); }
  .thumb:hover img { transform:scale(1.04); }
  .meta { padding:9px 11px; display:flex; flex-direction:column; gap:5px; }
  .title { font-size:13.5px; font-weight:600; line-height:1.3; overflow:hidden;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; min-height:1px; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11.5px; color:var(--muted); }
  .badge { padding:1px 7px; border-radius:999px; font-weight:700; font-size:11px; color:var(--ok); background:var(--ok-bg); text-transform:uppercase; }
  .src { font-family:var(--mono); }
  a.prov { color:var(--muted); text-decoration:none; }
  a.prov:hover { color:var(--accent); text-decoration:underline; }
  #status { text-align:center; color:var(--muted); padding:26px; }
  #more { display:none; margin:22px auto 0; padding:10px 20px; border:1px solid var(--border);
    border-radius:8px; background:var(--panel); color:var(--text); cursor:pointer; font-size:14px; }
  #more:hover { border-color:var(--accent); color:var(--accent); }
</style>
</head>
<body>
<header>
  <a href="/" class="brand">cc0-stock</a>
  <nav class="topnav"><a href="/">Home</a><a href="/gallery" class="on">Gallery</a><a href="/docs">MCP Docs</a></nav>
  <input id="q" type="search" placeholder="Search the CC0 library…  (blank = most recent)" autocomplete="off" />
  <span id="count"></span>
</header>
<main>
  <div id="grid" class="grid"></div>
  <div id="status">Loading…</div>
  <button id="more">Load more</button>
</main>
<script>
const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const moreBtn = document.getElementById("more");
const qEl = document.getElementById("q");
const countEl = document.getElementById("count");
const PER = 24;
let query = "", page = 1, done = false, loading = false, total = 0;

function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

function card(it){
  const tags = (it.tags || []).slice(0,3).join(", ");
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML =
    '<a class="thumb" href="'+esc(it.image_url)+'" target="_blank" rel="noopener">'+
      '<img loading="lazy" src="'+esc(it.image_url)+'" alt="'+esc(it.title||"")+'" '+
        'onerror="this.closest(\\'.card\\').style.display=\\'none\\'" />'+
    '</a>'+
    '<div class="meta">'+
      '<div class="title">'+esc(it.title||"Untitled")+'</div>'+
      '<div class="row"><span class="badge">'+esc(it.license||"")+'</span>'+
        (it.provenance_url ? '<a class="prov" href="'+esc(it.provenance_url)+'" target="_blank" rel="noopener">'+esc(it.source||"source")+' ↗</a>' : '<span class="src">'+esc(it.source||"")+'</span>')+
      '</div>'+
      (tags ? '<div class="row"><span>'+esc(tags)+'</span></div>' : '')+
    '</div>';
  return el;
}

async function load(reset){
  if (loading) return;
  loading = true;
  if (reset){ page = 1; done = false; total = 0; grid.innerHTML = ""; }
  statusEl.style.display = "block";
  statusEl.textContent = "Loading…";
  try {
    const res = await fetch("/search?q="+encodeURIComponent(query)+"&page="+page+"&per_page="+PER);
    const data = await res.json();
    const items = data.results || [];
    for (const it of items) grid.appendChild(card(it));
    total += items.length;
    if (items.length < PER) done = true;
    page++;
    countEl.textContent = total ? (total + (done ? "" : "+") + " image" + (total===1?"":"s")) : "";
    statusEl.style.display = total ? "none" : "block";
    if (!total) statusEl.textContent = query ? "No matches for “"+query+"”." : "Library is empty.";
    moreBtn.style.display = done ? "none" : "block";
  } catch (e) {
    statusEl.style.display = "block";
    statusEl.textContent = "Error: " + e.message;
  } finally {
    loading = false;
  }
}

let t;
qEl.addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(() => { query = qEl.value.trim(); load(true); }, 300);
});
moreBtn.addEventListener("click", () => load(false));
load(true);
</script>
</body>
</html>`;
