# Scrapling Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Crawlee with Scrapling as PDF Finder's primary crawling engine without changing the PostgreSQL schema, public search/download behavior, or Vercel integration.

**Architecture:** Add an isolated Python `scrapling-worker/` service that preserves the current HTTP contract and database tables. Scrapling 0.4.15 handles HTML crawling, link scheduling, robots.txt, per-domain throttling, and later dynamic/stealth sessions; an independent async PDF downloader enforces SSRF checks, redirect revalidation, PDF magic bytes, byte limits, SHA256 dedupe, filesystem storage, and PostgreSQL BYTEA persistence. Validate the Python worker on Railway before switching the existing `crawler-worker` service root directory.

**Tech Stack:** Python 3.12, Scrapling 0.4.15, FastAPI, Uvicorn, psycopg 3, httpx, pytest, Railway PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-09-05-crawler-first-design.md`

## Global Constraints

- Scrapling is the primary crawler; do not keep Crawlee in the production request path after cutover.
- Preserve existing `/health`, `/public/*`, and `/v1/*` response shapes used by Vercel and smoke tests.
- Reuse existing PostgreSQL tables; do not create a second document catalog.
- Respect robots.txt and site rate limits.
- No bypassing login, paywalls, CAPTCHAs, or access controls.
- Validate every outbound PDF URL and every redirect against public-IP/allowed-host rules.
- Persist every accepted PDF to PostgreSQL `document_blobs`; filesystem storage is an optimization, not the sole source of truth.
- A deployment may replace production only after tests, type/static checks, healthcheck, W3C crawl, database search, and same-origin download pass.

---

### Task 1: Python service skeleton and API compatibility

**Files:**
- Create: `scrapling-worker/pyproject.toml`
- Create: `scrapling-worker/Dockerfile`
- Create: `scrapling-worker/app/config.py`
- Create: `scrapling-worker/app/api.py`
- Create: `scrapling-worker/tests/test_api_contract.py`

**Interfaces:**
- Produces: `create_app(deps)` FastAPI application with `/health`, `/public/search`, `/public/file`, and authenticated `/v1/*` routes.

- [ ] Write failing contract tests for health, public search, public file, and Bearer-protected management routes.
- [ ] Run `pytest tests/test_api_contract.py -q`; verify failures are missing application/routes.
- [ ] Implement the minimal FastAPI skeleton and response shapes.
- [ ] Run the tests; verify they pass.
- [ ] Commit.

### Task 2: PostgreSQL repository compatibility

**Files:**
- Create: `scrapling-worker/app/repository.py`
- Create: `scrapling-worker/tests/test_repository_contract.py`

**Interfaces:**
- Produces: `Repository` methods for seed sites, crawl jobs, pages, discovered links, document/blob/source upserts, document lookup, and library search.

- [ ] Write failing repository contract tests using a fake async DB adapter.
- [ ] Verify RED.
- [ ] Implement SQL equivalent to the existing TypeScript repository.
- [ ] Verify GREEN.
- [ ] Commit.

### Task 3: Safe PDF downloader and hybrid persistence

**Files:**
- Create: `scrapling-worker/app/url_policy.py`
- Create: `scrapling-worker/app/pdf_store.py`
- Create: `scrapling-worker/tests/test_pdf_store.py`

**Interfaces:**
- Produces: `download_pdf(url, allowed_hosts, max_bytes)` and `persist_pdf(...)`.

- [ ] Write failing tests for private IPv4/IPv6 rejection, redirect revalidation, PDF magic validation, max-size enforcement, SHA256, filesystem key, and PostgreSQL blob persistence.
- [ ] Verify RED.
- [ ] Implement minimal downloader/store.
- [ ] Verify GREEN.
- [ ] Commit.

### Task 4: Scrapling spider

**Files:**
- Create: `scrapling-worker/app/spider.py`
- Create: `scrapling-worker/tests/test_spider_logic.py`

**Interfaces:**
- Produces: `PdfDiscoverySpider` that follows approved HTML links and emits PDF candidates with referrer, anchor text, and depth.

- [ ] Write failing tests for link classification, allowed-domain filtering, depth limits, PDF discovery, include/exclude rules, and anchor metadata.
- [ ] Verify RED.
- [ ] Implement with `scrapling.spiders.Spider`, `Response.follow`, `robots_txt_obey=True`, bounded concurrency, and AutoThrottle.
- [ ] Verify GREEN.
- [ ] Commit.

### Task 5: Crawl/ingest orchestration

**Files:**
- Create: `scrapling-worker/app/jobs.py`
- Create: `scrapling-worker/tests/test_jobs.py`

**Interfaces:**
- Produces: single-worker `JobRunner` and `run_seed_crawl(job_id)`, `run_ingest(job_id, url)`.

- [ ] Write failing status/counter tests.
- [ ] Verify RED.
- [ ] Implement queue, Spider execution, candidate download, dedupe, job counters, error isolation.
- [ ] Verify GREEN.
- [ ] Commit.

### Task 6: Production composition and migration

**Files:**
- Create: `scrapling-worker/app/main.py`
- Create: `scrapling-worker/tests/test_smoke_contract.py`

**Interfaces:**
- Produces: Uvicorn app on `$PORT`, same database and API token variables as the TypeScript service.

- [ ] Run all pytest tests and compile/import checks in Railway build.
- [ ] Deploy `scrapling-worker/` to the non-production validation service.
- [ ] Crawl W3C HTML page that links `html40.pdf`.
- [ ] Verify crawl job succeeded, one PDF downloaded, PostgreSQL document/blob/source rows exist.
- [ ] Verify `/public/search?q=html40.pdf` returns the document.
- [ ] Verify `/public/file?id=<id>` returns HTTP 200, `application/pdf`, `%PDF-`, and the expected byte size.
- [ ] Restart validation service and verify the same file still downloads from PostgreSQL Blob.
- [ ] Switch existing `crawler-worker` root directory to `scrapling-worker`, preserving its domain and environment variables.
- [ ] Re-run production health/search/download and a Chinese keyword fallback test from Vercel.
- [ ] Keep the TypeScript Crawlee directory for one rollback window, then mark it legacy.
