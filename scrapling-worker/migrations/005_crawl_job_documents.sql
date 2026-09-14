CREATE TABLE IF NOT EXISTS crawl_job_documents (
  crawl_job_id UUID NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (crawl_job_id, document_id)
);

CREATE INDEX IF NOT EXISTS crawl_job_documents_document_idx
  ON crawl_job_documents (document_id);
