# PDF Finder data model

Source of truth: [`scrapling-worker/migrations/001_init.sql`](scrapling-worker/migrations/001_init.sql), [`004_search_discovery.sql`](scrapling-worker/migrations/004_search_discovery.sql), [`005_crawl_job_documents.sql`](scrapling-worker/migrations/005_crawl_job_documents.sql), repository implementation, and [`frontend/lib/types.ts`](frontend/lib/types.ts).

| Entity | Identity / important fields | Relationships and lifecycle |
| --- | --- | --- |
| `documents` | UUID; unique PDF-byte SHA256; storage key/backend; MIME; byte size; title/filename/document number; observed timestamps | One logical document per byte hash; multiple origins are preserved in sources. |
| `document_blobs` | Document UUID primary key; SHA256; byte size; `content BYTEA`; timestamps | One durable blob per document. Filesystem cache is disposable. |
| `document_sources` | UUID; document UUID; exact/normalized source URL; host; referrer; anchor; HTTP filename; seen/status metadata | Many sources per document; unique `(document_id, normalized_source_url)` maintains provenance. |
| `seed_sites` | UUID; base URL; allowed hosts and patterns; depth/rate/concurrency/size limits; enabled flag; crawl interval | Persistent approved crawl policy. Zero interval disables scheduling. Search discovery does not create a seed. |
| `crawl_jobs` | UUID; optional seed; trigger type; start/normalized URL; timestamps; state/counters/error summary | `queued → running → succeeded / partial / failed / cancelled` in SQL. Search discovery uses `trigger_type=discovery` and a null seed; URL indexes support dedupe/cooldown. |
| `crawl_pages` | UUID; job UUID; URL/normalized URL; depth; HTTP/content metadata; title/error | Unique normalized URL per job; records crawl observations. |
| `crawl_job_documents` | Crawl-job UUID plus document UUID; creation timestamp | Additive many-to-many result ledger. It records the exact validated PDFs produced or deduplicated by a job without changing document titles or treating a search phrase as authoritative metadata. |
| `discovered_links` | UUID; unique normalized URL; referrer/anchor; host; likely-document flag; timestamps | Ingestion state: `new`, `queued`, `downloaded`, `rejected`, or `failed`. |

## Frontend contracts

`SearchResult` holds origin (`library`/`web`), source class, verified flag, score, title, source, snippet, reasons, content length, optional URL/final URL, and optional library UUID. Scores and counters come from existing deterministic logic/worker data; do not invent successful ingestion.

`SearchResponse` contains query, library-first results, optional warnings, and optional crawl metadata. Search returns `not_started` when selectable web candidates exist and creates no job. Other crawl states are `not_needed`, `started`, `running`, `complete`, and `unavailable`. Frontend `CrawlJobStatus` represents `queued`, `running`, `succeeded`, `partial`, and `failed`; SQL also permits `cancelled`. A polled job can include the library-safe metadata of its linked documents, allowing the UI to expose preview/download without depending on a second fuzzy query match.

The manual start request is an ephemeral browser-to-server command containing the current query and one to three unique selected source URLs. It is not a persisted domain entity. Successful submission creates the existing discovery `crawl_jobs`; the selection itself is local UI state and is cleared by a new search or a terminal batch.

The download request contains only a document UUID and optional `download=1`. Server configuration chooses a worker base and authentication token; neither the token nor its claims become document fields, browser payloads, or persisted frontend state. The response preserves the PDF byte content, safe filename, content type, disposition, and existing cache/security headers.

## Security and evidence boundary

The public corpus contains public downloadable PDFs and their provenance. Search discovery validates network safety, redirect targets, scope, byte limits, and PDF evidence before persistence. Credentials, private production data, Agent Memory, and generated inference must not enter this corpus as source documents. Preserve existing SHA256 identity and additive migration rules.
