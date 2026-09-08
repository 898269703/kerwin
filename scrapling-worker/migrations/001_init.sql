CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS seed_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  allowed_hosts JSONB NOT NULL DEFAULT '[]'::jsonb,
  include_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclude_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_depth INT NOT NULL DEFAULT 4,
  max_requests_per_minute INT NOT NULL DEFAULT 30,
  max_concurrency INT NOT NULL DEFAULT 2,
  max_pdf_bytes BIGINT NOT NULL DEFAULT 104857600,
  crawl_interval_minutes INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_site_id UUID REFERENCES seed_sites(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual','seed','discovery')),
  start_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled')),
  pages_fetched INT NOT NULL DEFAULT 0,
  files_discovered INT NOT NULL DEFAULT 0,
  files_downloaded INT NOT NULL DEFAULT 0,
  duplicates_found INT NOT NULL DEFAULT 0,
  errors_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_summary TEXT
);

CREATE TABLE IF NOT EXISTS crawl_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_job_id UUID NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  status_code INT,
  content_type TEXT,
  depth INT NOT NULL,
  page_title TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT,
  UNIQUE (crawl_job_id, normalized_url)
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 CHAR(64) NOT NULL UNIQUE,
  storage_backend TEXT NOT NULL DEFAULT 'railway_volume',
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size BIGINT NOT NULL,
  preferred_title TEXT,
  preferred_filename TEXT,
  document_number TEXT,
  document_number_normalized TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_title_trgm_idx ON documents USING gin (preferred_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_filename_trgm_idx ON documents USING gin (preferred_filename gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_number_trgm_idx ON documents USING gin (document_number_normalized gin_trgm_ops);

CREATE TABLE IF NOT EXISTS document_blobs (
  document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  sha256 CHAR(64) NOT NULL,
  byte_size BIGINT NOT NULL,
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_blobs_sha_idx ON document_blobs(sha256);

CREATE TABLE IF NOT EXISTS document_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  normalized_source_url TEXT NOT NULL,
  source_host TEXT NOT NULL,
  referrer_url TEXT,
  anchor_text TEXT,
  http_filename TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_http_status INT,
  UNIQUE (document_id, normalized_source_url)
);
CREATE INDEX IF NOT EXISTS document_sources_host_idx ON document_sources(source_host);

CREATE TABLE IF NOT EXISTS discovered_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL UNIQUE,
  referrer_url TEXT,
  source_host TEXT NOT NULL,
  anchor_text TEXT,
  likely_document BOOLEAN NOT NULL DEFAULT FALSE,
  ingestion_status TEXT NOT NULL DEFAULT 'new' CHECK (ingestion_status IN ('new','queued','downloaded','rejected','failed')),
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing deployments predate per-seed scheduling, so keep this migration
-- idempotent and additive instead of introducing a destructive schema reset.
ALTER TABLE seed_sites
  ADD COLUMN IF NOT EXISTS crawl_interval_minutes INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS seed_sites_scheduler_idx
  ON seed_sites (enabled, crawl_interval_minutes)
  WHERE enabled=TRUE AND crawl_interval_minutes > 0;

CREATE INDEX IF NOT EXISTS crawl_jobs_seed_status_idx
  ON crawl_jobs (seed_site_id, status);
