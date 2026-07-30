import { buildLabels, normalizeLicense, stripHtml } from "../labels.mjs";

const API = "https://commons.wikimedia.org/w/api.php";
const UA = "cc0-stock-ingest/0.1 (+https://github.com/your-org/cc0-stock)";
// 1024 keeps payloads small (faster downloads + smaller base64 uploads through the
// Worker) while staying plenty large for stock use.
const THUMB_WIDTH = 1024;

function cleanTitle(t) {
  return t.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ").trim();
}

export async function wikimediaSearch({ q, page, pageSize }) {
  const offset = (page - 1) * pageSize;
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    // Bias to genuinely CC0 files; normalizeLicense() is still the hard guarantee.
    gsrsearch: `filetype:bitmap ${q} hastemplate:Cc-zero`,
    gsrnamespace: "6",
    gsrlimit: String(pageSize),
    gsroffset: String(offset),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
  });

  const res = await fetch(`${API}?${params}`, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`Wikimedia search ${res.status}`);
  const data = await res.json();

  const pages = data.query?.pages ? Object.values(data.query.pages) : [];
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || !ii.mime?.startsWith("image/")) continue;
    const meta = ii.extmetadata ?? {};
    const lic = normalizeLicense({
      license: meta.License?.value ?? meta.LicenseShortName?.value ?? "",
      url: meta.LicenseUrl?.value,
    });
    if (!lic) continue;

    const categories = (meta.Categories?.value ?? "").split("|").map((s) => s.trim()).filter(Boolean);
    const title = cleanTitle(p.title);
    const { tags, tagSource } = buildLabels([], title, categories);
    const useThumb = Boolean(ii.thumburl);
    out.push({
      provider: "wikimedia",
      providerId: String(p.pageid),
      title: title || "Untitled",
      description: stripHtml(meta.ImageDescription?.value),
      creator: stripHtml(meta.Artist?.value),
      attribution: stripHtml(meta.Attribution?.value) ?? stripHtml(meta.Credit?.value),
      source: "wikimedia commons",
      license: lic.code,
      licenseVersion: lic.version,
      licenseUrl: lic.url,
      provenanceUrl: ii.descriptionurl,
      downloadUrl: useThumb ? ii.thumburl : ii.url,
      width: useThumb ? ii.thumbwidth : ii.width,
      height: useThumb ? ii.thumbheight : ii.height,
      tags,
      tagSource,
    });
  }
  return out;
}
