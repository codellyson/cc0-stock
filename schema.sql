-- cc0-stock schema.
-- Re-running this DROPs and recreates the tables (destructive) — it is an initial
-- migration, not an idempotent upgrade. Edit before running against data you care about.

DROP TABLE IF EXISTS images_fts;
DROP TABLE IF EXISTS images;

CREATE TABLE images (
  id              TEXT PRIMARY KEY,   -- "<provider>:<providerId>"
  provider        TEXT NOT NULL,      -- openverse | wikimedia
  title           TEXT,
  description     TEXT,
  creator         TEXT,
  attribution     TEXT,               -- exact attribution string when supplied
  source          TEXT,               -- upstream host (flickr, wikimedia commons, ...)
  license         TEXT NOT NULL,      -- cc0 | pdm (redistributable only)
  license_version TEXT,
  license_url     TEXT,
  provenance_url  TEXT,               -- landing page for vetting people/trademarks
  origin_url      TEXT,               -- direct URL the bytes were fetched from
  width           INTEGER,
  height          INTEGER,
  mime_type       TEXT,
  r2_key          TEXT NOT NULL,      -- object key in R2
  sha256          TEXT NOT NULL,      -- byte hash for exact-duplicate detection
  phash           TEXT,               -- 64-bit dHash (hex) for near-duplicate detection; null if undecodable
  tags            TEXT,               -- JSON array of cleaned label strings
  tag_source      TEXT,               -- provenance of the labels, e.g. "provider+title"
  ingested_at     TEXT NOT NULL       -- ISO timestamp
);

CREATE INDEX        idx_images_license  ON images(license);
CREATE INDEX        idx_images_provider ON images(provider);
CREATE INDEX        idx_images_ingested ON images(ingested_at);
CREATE UNIQUE INDEX idx_images_sha256   ON images(sha256);

-- Full-text index for keyword search over title, description, and tags. `id` is
-- stored but not tokenized so we can join back to `images`.
CREATE VIRTUAL TABLE images_fts USING fts5(
  id UNINDEXED,
  title,
  description,
  tags,
  tokenize = 'porter'
);
