// Labelling normalization (ported from the original Worker src/labels.ts).

const CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/";
const PDM_URL = "https://creativecommons.org/publicdomain/mark/1.0/";

export function normalizeLicense(raw) {
  const l = (raw.license ?? "").toLowerCase().trim();
  if (l === "cc0" || l === "cc-zero") {
    return { code: "cc0", version: raw.version ?? "1.0", url: raw.url ?? CC0_URL };
  }
  if (l === "pdm" || l === "pd" || l.startsWith("public domain") || l.startsWith("pd-")) {
    return { code: "pdm", version: raw.version, url: raw.url ?? PDM_URL };
  }
  return null;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "are", "was", "over", "under",
  "into", "out", "off", "its", "his", "her", "their", "our", "your", "you", "not",
  "img", "image", "images", "photo", "photos", "picture", "file", "jpg", "jpeg", "png",
]);

const NOISE = [
  /^cc[-\s]?zero$/i, /^cc0$/i, /^cc-/i, /^pd[-\s]/i, /public domain/i, /^gfdl/i,
  /licens/i, /^category$/i, /wikimedia/i, /wikipedia/i, /^files?\b/i, /^media\b/i,
  /images? from/i, /uploaded/i, /self-published/i, /flickr/i, /featured picture/i,
  /quality image/i, /valued image/i,
  /photograph(s)? taken/i, /taken (on|in|with|by)/i, /unknown date/i, /needing/i, /\bmedia\b/i,
  /\b(canon|nikon|sony|fujifilm|olympus|pentax|leica|sigma|tamron|dslr|slr|eos)\b/i, /\biso\d+/i,
];

function cleanOne(raw) {
  let t = raw
    .replace(/^Category:/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/[_/]+/g, " ")
    .trim()
    .toLowerCase();
  if (!t || t.length < 2 || t.length > 40) return null;
  if (/^\d+$/.test(t)) return null;
  if (/\b(18|19|20)\d{2}\b/.test(t)) return null;
  if (NOISE.some((re) => re.test(t))) return null;
  if (STOPWORDS.has(t)) return null;
  return t;
}

export function cleanTags(raw) {
  const out = new Set();
  for (const r of raw) {
    const c = cleanOne(r);
    if (c) out.add(c);
  }
  return [...out];
}

export function tagsFromTitle(title) {
  if (!title) return [];
  const out = new Set();
  for (const w of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return [...out];
}

export function buildLabels(providerTags, title, categories = []) {
  const fromProvider = cleanTags(providerTags);
  const fromCategories = cleanTags(categories);
  const sources = [];
  if (fromProvider.length) sources.push("provider");
  if (fromCategories.length) sources.push("categories");
  let tags = [...new Set([...fromProvider, ...fromCategories])];
  if (tags.length < 3) {
    const fromTitle = tagsFromTitle(title);
    if (fromTitle.length) {
      tags = [...new Set([...tags, ...fromTitle])];
      sources.push("title");
    }
  }
  return { tags, tagSource: sources.join("+") || "none" };
}

export function stripHtml(s) {
  if (!s) return undefined;
  const t = s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  return t || undefined;
}
