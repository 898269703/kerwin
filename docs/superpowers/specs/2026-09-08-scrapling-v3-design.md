# PDF Finder Scrapling V3 Architecture Design

Date: 2026-09-08  
Status: Proposed; implementation starts only after user review  
Migration: blue/green from Crawlee TypeScript worker to Scrapling Python worker

## 1. Decision

PDF Finder V3 will use **Scrapling as the sole long-term crawler engine**. Crawlee remains only as a temporary rollback target during migration and is retired after the observation window.

Stable components:
- Vercel / Next.js frontend and current search UX.
- Existing public and protected crawler API contracts.
- PostgreSQL metadata model and existing document IDs.
- SHA256 document identity and deduplication.
- `document_sources` provenance.
- `document_blobs` PostgreSQL BYTEA durable fallback.
- SearXNG as external discovery only.
- Local-library-first search.

Runtime changes:

```text
Before: Node 22 + TypeScript + Crawlee
After:  Python 3.12 + Scrapling 0.4.15 + FastAPI + asyncpg + httpx
```

## 2. Goals

V3 must:
1. Recursively crawl approved public technical-document sites.
2. Respect robots.txt and seed rate limits.
3. Use HTTP first; use JS rendering only when needed.
4. Discover direct PDFs and extensionless download endpoints.
5. Physically download and validate PDF bytes.
6. Deduplicate by SHA256 while retaining every source URL.
7. Persist bytes so worker restart does not break an indexed document.
8. Keep Vercel/API behavior compatible.
9. Preserve SSRF/private-network protection on requests, redirects, and recovery.
10. Support incremental recrawls.
11. Provide one-switch rollback to Crawlee during migration.
12. Provide a Python base for later PyMuPDF/OCR/RAG work.

## 3. Non-goals

V3 will not:
- bypass login, CAPTCHA, paywalls, or explicit access controls;
- use Stealth mode by default to defeat anti-bot controls;
- crawl the whole internet;
- add Redis/Kafka/distributed workers;
- move the corpus to R2/S3 during this migration;
- add OCR/embeddings during the crawler cutover;
- rewrite the frontend;
- change SHA256 document identity;
- permanently operate Crawlee and Scrapling together.

## 4. Why Scrapling

As of 2026-09-08, Scrapling 0.4.15 provides an async Spider framework with request deduplication, concurrent crawling, robots.txt support, per-domain throttling, AutoThrottle, pause/resume, multi-session crawling, and browser-backed dynamic fetching. A Spider can use a fast HTTP session by default and an asynchronous dynamic browser session for JS-only pages.

Python also aligns with the next document pipeline:

```text
Scrapling -> PDF acquisition -> PyMuPDF -> OCR -> metadata extraction -> full text -> embeddings/RAG
```

## 5. Target architecture

```text
Vercel / PDF Finder
        |
        v
Scrapling Python Worker (Railway)
  - FastAPI
  - PostgreSQL job queue loop
  - Scrapling Spider
  - HTTP session
  - Dynamic session fallback
  - PDF downloader / validator
  - SHA256 / metadata / recovery
        |
        +---- PostgreSQL
        |       - metadata
        |       - sources
        |       - crawl state
        |       - PDF BYTEA blob
        |
        +---- /data
                - temp files
                - local cache only

External discovery:
Vercel -> own corpus first -> SearXNG only when corpus is weak/empty
```

## 6. Blue/green migration

### Blue
Current Node/Crawlee service remains frozen as rollback. No unrelated refactors.

### Green
Create a separate `scrapling-worker` Railway service. It shares PostgreSQL semantics but initially receives only explicit validation jobs.

### Cutover
After all gates pass:
1. Switch the server-side crawler base URL to Scrapling.
2. Stop scheduling new Crawlee jobs.
3. Keep Crawlee deployable for about seven days.
4. Compare job success, PDF discovery, duplicate rate, blocked rate, dynamic fallback, and file-serving success.
5. Retire Crawlee after the observation period.

### Rollback
Rollback is only a backend base-URL/config switch. No database rollback is required.

## 7. Repository layout

```text
scrapling-worker/
├── pyproject.toml
├── uv.lock
├── Dockerfile
├── migrations/002_scrapling_v3.sql
├── app/
│   ├── main.py
│   ├── api.py
│   ├── config.py
│   ├── lifecycle.py
│   ├── crawler/
│   │   ├── spider.py
│   │   ├── sessions.py
│   │   ├── link_classifier.py
│   │   ├── url_policy.py
│   │   ├── incremental.py
│   │   └── priority.py
│   ├── documents/
│   │   ├── downloader.py
│   │   ├── validator.py
│   │   ├── hashing.py
│   │   ├── metadata.py
│   │   └── recovery.py
│   ├── repositories/
│   │   ├── database.py
│   │   ├── seeds.py
│   │   ├── jobs.py
│   │   ├── pages.py
│   │   └── documents.py
│   └── storage/
│       ├── cache.py
│       └── blob.py
└── tests/
    ├── unit/
    ├── integration/
    ├── fixtures/
    └── smoke/
```

## 8. Runtime

Pin for the first production migration:
- Python 3.12
- Scrapling 0.4.15
- FastAPI / Uvicorn
- asyncpg
- httpx
- pydantic-settings
- pytest / pytest-asyncio
- `uv` lockfile workflow

## 9. Session policy

Default crawl mode is normal HTTP.

Initial Spider policy:

```text
robots_txt_obey = true
concurrent_requests = 6
concurrent_requests_per_domain = 2
autothrottle_enabled = true
autothrottle_start_delay = 2s
autothrottle_max_delay = 60s
```

Seed limits remain authoritative; Scrapling settings may be lower but never more aggressive.

### Dynamic fallback
Use `AsyncDynamicSession` only if:
- the page is approved/in-domain;
- HTTP mode returns HTML but useful content/attachment links are missing;
- there is evidence of JS-driven content;
- the job is within the dynamic budget.

Initial dynamic budget: 20 pages/job.

### Stealth
`AsyncStealthySession` is not enabled in the default V3 path. Access-control/anti-bot blocks become `blocked/manual-review`, not an automatic bypass attempt.

## 10. Link classification

Every discovered URL becomes one of:
- `html_page`
- `document_candidate`
- `external_document_candidate`
- `unsupported_asset`
- `blocked`

PDF evidence may include:
- `.pdf` suffix;
- anchor text such as PDF / 附件 / 下载 / 文件;
- configured `/download`, `/attachment`, `/file/get` patterns;
- `Content-Type: application/pdf`;
- `Content-Disposition` PDF filename;
- `%PDF-` magic bytes.

Only byte-level validation can finally accept a document as PDF.

## 11. Crawl boundary

- Recursive HTML crawling is limited to `seed_sites.allowed_hosts`.
- An external attachment directly linked from an allowed page may be downloaded if it passes provenance and SSRF checks.
- External attachment hosts are not recursively crawled.

## 12. Security / SSRF

Every request, redirect, and recovery request must:
1. use HTTP/HTTPS only;
2. reject localhost/loopback;
3. reject RFC1918 private IPv4;
4. reject link-local networks;
5. reject IPv6 loopback/ULA/private ranges;
6. reject cloud metadata endpoints;
7. revalidate every redirect;
8. enforce allowed-host policy for recursive HTML;
9. require explicit referrer/source provenance for external attachments.

For recovery, an existing exact `document_sources.source_url` is valid provenance even if the old seed was removed. The recovered PDF must still pass network safety and match the existing document SHA256.

## 13. Crawl priority and limits

Increase priority for: 政策、通知、公告、标准、规范、定额、费用、造价、价格、电力、输电、变电、工程、附件、下载、PDF.

Defaults:
- depth 3 for new seeds;
- max 500 pages/job;
- max 100 PDFs/job;
- max PDF 100 MiB;
- global concurrency 6;
- per-domain concurrency <= 2;
- retries <= 2;
- dynamic pages <= 20/job.

Hitting a configured limit produces `partial`, not a process crash.

## 14. PDF acquisition

```text
candidate
 -> safety/provenance check
 -> streaming GET
 -> redirect revalidation
 -> size ceiling
 -> MIME/disposition evidence
 -> %PDF- validation
 -> temp file
 -> streaming SHA256
 -> dedupe lookup
 -> PostgreSQL durable blob
 -> optional /data cache
 -> metadata/source transaction
```

Do not buffer a full PDF merely to calculate SHA256.

## 15. Identity and storage

Document identity remains SHA256 of PDF bytes.

Same bytes from multiple URLs:
- one `documents` row;
- one `document_blobs` row;
- multiple `document_sources` rows.

Durable V3 read order:

```text
/data cache
 -> miss
PostgreSQL document_blobs
 -> miss
safe recovery from exact historical document_source
 -> recovered SHA256 must match
 -> repopulate blob/cache
 -> otherwise 404
```

`/data` is a cache/temp location, not the sole authoritative copy.

Object storage (R2/S3) is a later migration when corpus scale justifies it.

## 16. Database compatibility

Keep existing tables:
- `seed_sites`
- `crawl_jobs`
- `crawl_pages`
- `documents`
- `document_blobs`
- `document_sources`
- `discovered_links`

Only additive migration is allowed.

Add to `crawl_pages`:
- `crawler_engine` default `crawlee`
- `fetch_mode` (`http`/`dynamic`)
- `etag`
- `last_modified`
- `page_hash`
- `last_seen_at`

Add to `crawl_jobs`:
- `crawler_engine` default `crawlee`
- `dynamic_pages_used` default 0
- `blocked_count` default 0

Add to `document_sources`:
- `crawler_engine`
- `fetch_mode`

Scrapling rows use `crawler_engine='scrapling'`.

## 17. Incremental crawling

Persist normalized URL, ETag, Last-Modified, page hash, and last-seen time.

Recrawl:
1. send conditional requests where supported;
2. treat 304 as unchanged;
3. otherwise compare normalized page hash;
4. reparse only new/changed pages unless full refresh is requested;
5. refresh source last-seen metadata when documents are rediscovered.

Scrapling request dedupe is per crawl; PostgreSQL is cross-run crawl memory.

## 18. Job model

No Redis in V3.

FastAPI inserts jobs into PostgreSQL. A background loop claims queued jobs with `FOR UPDATE SKIP LOCKED`.

Initial rule: one active crawl job per Scrapling service instance.

States:

```text
queued -> running -> succeeded | partial | failed | cancelled
```

Startup reconciliation must handle stale `running` jobs after process restart.

## 19. API compatibility

Public:
- `GET /health`
- `GET /public/search?q=&limit=`
- `GET /public/file?id=`

Bearer-protected:
- `GET /v1/documents/search?q=`
- `GET /v1/documents/{id}`
- `GET /v1/documents/{id}/file`
- `POST /v1/crawl/jobs`
- `GET /v1/crawl/jobs/{id}`
- `POST /v1/ingest`
- `GET /v1/seeds`
- `POST /v1/seeds`

Frontend-consumed fields remain compatible: `id`, `title`, `filename`, `documentNumber`, `byteSize`, `sourceCount`, `score`, `downloadPath`.

New fields may be added; current fields cannot be removed or renamed during migration.

## 20. Search semantics

No search architecture change:

```text
query -> own corpus first -> strong hit: library result
                         -> weak/empty/error: SearXNG discovery
```

Scrapling builds the local corpus; it does not replace SearXNG.

## 21. Error handling / observability

Isolate request/document errors so one bad URL does not crash a job.

Job metrics:
- pages fetched;
- HTTP pages;
- dynamic pages;
- files discovered/downloaded;
- duplicates;
- blocked pages;
- errors;
- duration.

Structured logs include job/seed/engine/fetch-mode/host/event/status/document ID. Never log API tokens, DB credentials, or sensitive headers.

## 22. Testing

Development uses RED -> GREEN -> refactor.

### Unit
Cover URL normalization, host policy, IPv4/IPv6 private rejection, redirects, link classification/priority, limits, PDF validation, filename extraction, streaming SHA256, storage-key validation, source dedupe, incremental page hash, and job state transitions.

### Integration fixture site
Must contain:
1. nested HTML;
2. direct `.pdf`;
3. extensionless PDF endpoint;
4. duplicate PDF through two URLs;
5. fake `.pdf` non-PDF;
6. oversized PDF;
7. unsafe redirect;
8. robots-disallowed route;
9. JS-generated/API-backed attachment;
10. changed/unchanged page variants.

Expected: duplicate bytes create one document/two sources; unsafe/oversized/fake files are rejected; robots enforced; dynamic fixture requires approved dynamic fallback; isolated failures do not kill the job.

### API contract
Run the same black-box API suite against Crawlee blue and Scrapling green.

### Database compatibility
Initialize with the current TypeScript schema, apply additive V3 migration, and prove existing W3C document/source/blob rows remain readable.

## 23. Production acceptance

Green cannot receive production traffic until these pass:

### W3C baseline
- HTML page crawled;
- benchmark PDF discovered/downloaded;
- `%PDF-` valid;
- SHA256 matches existing identity if unchanged;
- no duplicate `documents` row;
- `/public/search` finds it;
- `/public/file` returns 200/application-pdf and correct bytes.

### Chinese static public page
Approved government/energy page with normal attachment succeeds without browser fallback.

### Extensionless PDF
Endpoint without `.pdf` is correctly identified and stored.

### Dynamic page
HTTP mode misses required attachment; approved DynamicSession finds it; PDF is ingested and served.

### Restart persistence — mandatory
1. ingest PDF;
2. verify `document_blobs` contains bytes;
3. ignore/remove local cache;
4. restart/redeploy green worker;
5. call `/public/file`;
6. require HTTP 200 and identical SHA256.

This directly prevents the previous failure mode where PostgreSQL knew the document but a missing Railway volume caused 404.

## 24. Cutover gates

Require all unit/integration/API/database tests green plus all four production cases and restart persistence. Also require stable `/health`, no secret exposure, no API response incompatibility, and a verified Crawlee rollback configuration.

## 25. Observation and retirement

For about seven days after cutover:
- no new Crawlee jobs;
- keep Crawlee deployable;
- compare success/partial/failure, discovery, blocked/dynamic counts, duplicate rate, and file-serving reliability;
- watch PostgreSQL blob growth.

Rollback on corruption/SHA mismatch, file-serving regression, materially lower discovery success, uncontrolled browser resource usage, DB incompatibility, or security regression.

After the window passes, archive Crawlee code, remove the Crawlee Railway service and active dependencies, and mark Scrapling as the sole crawler engine.

## 26. Future V4

After V3 is stable: PyMuPDF, OCR, Chinese document-number/publisher extraction, version grouping, full-text index, embeddings/RAG, and R2/S3 storage may be designed as a separate subsystem.

## 27. Final acceptance definition

Scrapling V3 is complete only when a production user can search a document collected by Scrapling and receive the bytes from PDF Finder's own durable corpus **after a worker restart**, without requiring the source website to be online at download time.

> Scrapling discovers it; PDF Finder owns it; PostgreSQL remembers it; a restart does not lose it.

## 28. References validated on 2026-09-08

- Scrapling Spider getting started: concurrent crawling, robots.txt, `response.follow()`, AutoThrottle.
- Scrapling Spider sessions: HTTP and asynchronous dynamic browser sessions in one Spider.
- Scrapling advanced features: per-domain concurrency and adaptive throttling.
- Scrapling changelog: v0.4.15 released 2026-08-23; Spider framework introduced in v0.4 and expanded throughout 0.4.x.
