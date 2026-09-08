ALTER TABLE crawl_jobs
  ADD COLUMN IF NOT EXISTS normalized_start_url TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE crawl_jobs
SET normalized_start_url = start_url
WHERE normalized_start_url IS NULL;

CREATE INDEX IF NOT EXISTS crawl_jobs_active_url_idx
  ON crawl_jobs (normalized_start_url, status);

CREATE INDEX IF NOT EXISTS crawl_jobs_created_at_idx
  ON crawl_jobs (created_at DESC);
