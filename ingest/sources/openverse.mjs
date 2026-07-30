import { buildLabels, normalizeLicense } from "../labels.mjs";

const BASE = "https://api.openverse.org/v1";
const UA = "cc0-stock-ingest/0.1 (+https://github.com/your-org/cc0-stock)";

async function getToken() {
  const id = process.env.OPENVERSE_CLIENT_ID;
  const secret = process.env.OPENVERSE_CLIENT_SECRET;
  if (!id || !secret) return null;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
  });
  const res = await fetch(`${BASE}/auth_tokens/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body,
  });
  if (!res.ok) throw new Error(`Openverse token ${res.status}`);
  return (await res.json()).access_token;
}

export async function openverseSearch({ q, page, pageSize }) {
  const token = await getToken();
  const params = new URLSearchParams({
    q,
    license: "cc0,pdm",
    page: String(page),
    page_size: String(pageSize),
    mature: "false",
  });
  const headers = { "user-agent": UA };
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/images/?${params}`, { headers });
  if (!res.ok) throw new Error(`Openverse search ${res.status}`);
  const data = await res.json();

  const out = [];
  for (const r of data.results ?? []) {
    const lic = normalizeLicense({ license: r.license, version: r.license_version, url: r.license_url });
    if (!lic) continue;
    const { tags, tagSource } = buildLabels((r.tags ?? []).map((t) => t.name), r.title);
    out.push({
      provider: "openverse",
      providerId: r.id,
      title: (r.title ?? "").trim() || "Untitled",
      creator: r.creator,
      attribution: r.attribution,
      source: r.source ?? "openverse",
      license: lic.code,
      licenseVersion: lic.version,
      licenseUrl: lic.url,
      provenanceUrl: r.foreign_landing_url,
      downloadUrl: r.url,
      width: r.width,
      height: r.height,
      tags,
      tagSource,
    });
  }
  return out;
}
