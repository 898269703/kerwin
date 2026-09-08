# PDF Finder Search-Miss Automatic Crawl Design

Date: 2026-09-08  
Status: Proposed; implementation starts only after user review  
Scope: integrate the existing Vercel PDF Finder search UX with the production Scrapling worker so a library miss can trigger a bounded crawl and surface newly downloaded PDFs without exposing crawler credentials.

## 1. Decision

PDF Finder will keep a **library-first, search-fast, crawl-in-background** architecture.

The browser never calls Scrapling directly. Vercel remains the public application boundary and search orchestrator; Railway Scrapling remains the only component allowed to crawl, download, validate, deduplicate, and persist PDFs.

```text
Browser / PWA
    |
    v
Vercel Next.js
  - /api/search
  - /api/search/status
  - /api/library/file
    |
    +--> Scrapling Worker on Railway
    |      - bounded search-discovery jobs
    |      - PDF download + validation
    |      - SHA256 dedupe
    |      - live job progress
    |
    +--> SearXNG
    |      - candidate discovery only
    |
    +--> Postgres-backed library API
           - existing documents first
           - newly crawled PDFs appear here
```

A user should get useful search results immediately. A crawl is an enhancement after a library miss, not a blocking prerequisite for every search.

## 2. Current production baseline

The current production PWA is `pdf-search-pwa` on Vercel.

Verified baseline on 2026-09-08:
- Next.js 16.3.3.
- Production domain: `pdf-search-pwa.vercel.app`.
- Existing routes: `/`, `/api/search`, `/api/library/file`, `/manifest.webmanifest`.
- The browser submits `POST /api/search`.
- Existing UI already distinguishes `library`, `official`, `institutional`, and general public results.
- Existing UI already prioritizes local-library documents and offers direct local PDF download.
- The Vercel project currently has no Git repository link.

This production deployment remains untouched until the repository-backed frontend reaches parity in a Vercel Preview deployment.

## 3. Goals

The feature must:
1. Return existing library/web search results immediately.
2. Trigger automatic crawling only when the local library has no result for the query.
3. Never expose `CRAWLER_API_TOKEN` to the browser.
4. Use SearXNG only to discover candidate URLs; Scrapling performs all crawling/downloading.
5. Deep-crawl only tightly scoped public URLs with strict runtime/page/PDF limits.
6. Show queued/running/completed crawl progress in the UI.
7. Refresh the local library after the crawl and promote newly ingested PDFs to the top.
8. Deduplicate repeated user-triggered crawls for the same candidate URL.
9. Preserve current search behavior if the crawler is unavailable.
10. Keep the existing production deployment rollbackable until preview acceptance passes.

## 4. Non-goals

This phase will not:
- crawl the whole internet;
- automatically create permanent seed sites from arbitrary search results;
- bypass login, CAPTCHA, paywalls, robots.txt, or explicit anti-bot controls;
- expose Railway management endpoints publicly to the browser;
- add Redis, Kafka, Celery, or a second queue service;
- add OCR, embeddings, RAG, or full-text PDF extraction;
- redesign the entire PDF Finder UI;
- replace SearXNG;
- remove the existing local-library-first search path;
- switch production traffic before a preview acceptance run passes.

## 5. Frontend source-of-truth migration

Because the current Vercel project is not Git-linked, the first implementation milestone is to create a repository-backed frontend at:

```text
frontend/
  app/
  lib/
  public/
  tests/
  package.json
  next.config.ts
  tsconfig.json
```

The existing production deployment is the visual/behavioral acceptance baseline. The repository version must preserve:
- current page copy and layout;
- current search form behavior;
- current result cards and ranking labels;
- current `/api/search` response compatibility for existing fields;
- current `/api/library/file` behavior;
- PWA manifest behavior.

Only after parity tests and a Vercel Preview pass will the new crawl-progress UI be enabled.

The long-term source of truth becomes `898269703/kerwin` branch `crawler-mvp`, then the Vercel project should be Git-linked so future deploys are reproducible.

## 6. Search flow

### 6.1 Initial request

Browser sends:

```http
POST /api/search
Content-Type: application/json

{"query":"国家电网财〔2014〕156号"}
```

Vercel performs:
1. Search local library.
2. Search SearXNG/current web discovery path.
3. Rank/merge results exactly as today.
4. If `libraryResults.length > 0`, return immediately with `crawl.state = "not_needed"`.
5. If `libraryResults.length === 0`, choose bounded crawl candidates and ask Scrapling to enqueue them.
6. Return search results immediately together with crawl job IDs.

Initial auto-crawl trigger is deliberately strict: **zero library results only**. Weak-hit crawling can be considered later after production metrics exist.

### 6.2 Response extension

Existing response fields stay unchanged. Add one optional object:

```json
{
  "query": "...",
  "results": [],
  "warnings": [],
  "crawl": {
    "state": "started",
    "jobs": [
      {
        "id": "uuid",
        "startUrl": "https://example.gov/doc/123",
        "status": "queued"
      }
    ],
    "retryAfterMs": 2000
  }
}
```

Allowed `crawl.state` values:
- `not_needed`
- `started`
- `running`
- `complete`
- `unavailable`

Failure to enqueue a crawl must not turn a successful web search into HTTP 500. The response can contain web results plus a warning and `crawl.state = "unavailable"`.

## 7. Candidate selection

The server chooses at most **3** crawl candidates from the ranked web results.

Priority:
1. verified direct PDF URL;
2. official/institutional page likely to contain attachments;
3. other high-confidence public page only when it passes the ephemeral crawl policy.

Reject from automatic crawling:
- localhost/private/link-local/metadata IPs;
- non-HTTP(S) URLs;
- URLs containing embedded credentials;
- login/account/cart/upload/admin-style pages;
- obvious media/archive/executable assets;
- candidates whose public host cannot be safely resolved;
- candidates requiring access-control bypass.

SearXNG ranking is not itself a security trust signal. Scrapling independently revalidates every URL and redirect.

## 8. Two candidate execution modes

### 8.1 Direct PDF ingest

For a candidate that already looks like a direct PDF/download endpoint:

```text
candidate
 -> public-network validation
 -> streaming GET
 -> redirect validation
 -> size cap
 -> Content-Type / Content-Disposition / %PDF validation
 -> SHA256
 -> persist document + source
```

This is the cheapest path and should be preferred.

### 8.2 Ephemeral page crawl

For an HTML candidate, create a temporary crawl policy derived from the exact candidate URL. This policy is not written into `seed_sites`.

Default search-triggered limits:
- max 20 pages/job;
- max 10 PDFs/job;
- max depth 2;
- max runtime 120 seconds;
- concurrency 1 per host;
- max dynamic pages 3;
- robots.txt obeyed;
- recursive HTML restricted to the candidate host and candidate path subtree;
- external directly linked PDF attachments may be downloaded after provenance/SSRF validation;
- external HTML pages are never recursively followed.

A page crawl that hits a cap returns `partial`, not a process failure.

## 9. Scrapling worker API

Add protected endpoints behind the existing bearer token.

### 9.1 Enqueue search-discovery candidate

```http
POST /v1/search-discovery/jobs
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://example.gov/notices/123",
  "query": "文件名或文号",
  "mode": "auto"
}
```

Response:

```json
{
  "job": {
    "id": "uuid",
    "status": "queued",
    "startUrl": "https://example.gov/notices/123",
    "reused": false
  }
}
```

The worker decides direct-ingest vs ephemeral-crawl after validating the URL. Vercel does not tell the worker to weaken safety rules.

### 9.2 Job status

Reuse the existing protected job endpoint:

```http
GET /v1/crawl/jobs/{id}
```

The existing counters remain authoritative:
- `pagesFetched`
- `filesDiscovered`
- `filesDownloaded`
- `duplicatesFound`
- `errorsCount`
- `status`

## 10. Job deduplication and cooldown

Repeated searches must not create a new crawl storm.

Extend `crawl_jobs` with additive fields:

```sql
ALTER TABLE crawl_jobs
  ADD COLUMN IF NOT EXISTS normalized_start_url TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS crawl_jobs_active_url_idx
  ON crawl_jobs (normalized_start_url, status);

CREATE INDEX IF NOT EXISTS crawl_jobs_created_at_idx
  ON crawl_jobs (created_at DESC);
```

Rules:
1. If the same normalized URL already has `queued` or `running`, reuse that job.
2. If the same URL completed successfully/partially within the last 30 minutes, reuse the recent terminal job and do not recrawl.
3. Failed jobs may be retried after a short cooldown; initial value 5 minutes.
4. Active-job claim must be atomic at the repository/database layer.

The response marks a reused job with `reused: true` so the orchestrator can still poll it.

## 11. Trigger type compatibility

The current `crawl_jobs.trigger_type` check supports `manual`, `seed`, and `discovery`.

Search-triggered candidate jobs will initially reuse `trigger_type = 'discovery'` to avoid a destructive check-constraint migration. Their mode is distinguished by `seed_site_id IS NULL` plus normalized URL / runtime policy in the job payload constructed by the worker.

A dedicated `search` trigger type may be introduced later only if analytics needs justify it.

## 12. Vercel server-side integration

New server modules:

```text
frontend/lib/crawler-client.ts
  - enqueueSearchDiscovery(url, query)
  - getCrawlJob(id)

frontend/lib/search-orchestrator.ts
  - search library
  - search web
  - rank candidates
  - decide whether crawl is needed
  - enqueue bounded jobs

frontend/app/api/search/route.ts
  - existing public contract + optional crawl metadata

frontend/app/api/search/status/route.ts
  - poll protected Scrapling jobs server-side
  - refresh local-library search when jobs finish
```

Required server-only environment variables:

```text
CRAWLER_BASE_URL
CRAWLER_API_TOKEN
```

They must never use the `NEXT_PUBLIC_` prefix.

## 13. Status polling contract

Browser calls a Vercel route, never Railway directly:

```http
GET /api/search/status?q=<encoded>&jobId=<id>&jobId=<id>
```

Response:

```json
{
  "state": "running",
  "jobs": [
    {
      "id": "...",
      "status": "running",
      "pagesFetched": 8,
      "filesDiscovered": 2,
      "filesDownloaded": 1,
      "errorsCount": 0
    }
  ],
  "libraryResults": []
}
```

When every job is terminal, the Vercel route re-runs the local-library query and returns any newly stored documents.

The browser does not need to submit another crawl-capable `/api/search` request, avoiding accidental re-enqueue loops.

## 14. Frontend state machine

Search UI states:

```text
idle
  -> searching
      -> results_only
      -> results + crawl_queued
            -> crawl_running
                -> crawl_complete_with_library_hit
                -> crawl_complete_no_new_hit
                -> crawl_partial
                -> crawl_unavailable
```

Behavior:
- show web results immediately;
- render one non-blocking crawl progress panel above results;
- poll every 2 seconds initially;
- back off to 4 seconds after 30 seconds;
- stop polling after all jobs are terminal or after 150 seconds client-side;
- if the tab becomes hidden, polling may slow down but must resume on focus;
- never start a second crawl from the status endpoint.

Suggested Chinese copy:
- queued: `正在准备深度查找…`
- running: `正在抓取公开来源：已检查 {pages} 个页面，发现 {pdfs} 个 PDF`
- newly ingested: `已找到并收录新的 PDF，可直接从本站下载。`
- no new file: `深度查找已完成，暂未发现新的可下载 PDF。`
- unavailable: `深度查找暂时不可用，已保留当前互联网搜索结果。`

## 15. Result merge after crawl

New library results are authoritative and move above web candidates.

Deduplication priority:
1. same `libraryId`;
2. same canonical final URL/source URL;
3. same normalized title/document number when confidence is high.

If a new library PDF corresponds to an existing web candidate, replace the web card rather than displaying both.

Existing score/ranking semantics remain otherwise unchanged.

## 16. Security boundary

### Browser
Can only access public Vercel routes.

### Vercel
May hold `CRAWLER_API_TOKEN`; it validates request shape and chooses candidate URLs but cannot disable Scrapling safety checks.

### Scrapling
Authoritative for:
- public/private network resolution;
- redirect revalidation;
- robots policy;
- path/host scope;
- max pages/runtime/PDFs;
- byte-level PDF validation;
- external attachment provenance;
- SHA256 deduplication.

No endpoint accepts arbitrary browser-supplied `allowedHosts`, concurrency, page caps, or dynamic-page caps.

## 17. Failure behavior

### SearXNG fails
Return local-library results if present. Do not enqueue crawl without candidates.

### Scrapling enqueue fails
Return current web results with `crawl.state = unavailable` and warning. Search remains usable.

### One candidate job fails
Other candidate jobs continue. Final UI may show partial completion.

### Worker restarts
Existing startup recovery marks orphaned queued/running jobs failed. Status polling terminates cleanly; the browser does not hang forever.

### PDF download fails
Candidate stays a web result. Failure is recorded in the crawl job; it never becomes a local-library document.

### Vercel status route times out
Return the most recent known job information when possible; frontend retries within its polling budget.

## 18. Observability

Minimum production metrics/log fields:
- query hash or redacted query identifier (avoid leaking unnecessary query text into logs);
- crawl requested/not requested;
- candidate count;
- job ID;
- reused/new job;
- queue-to-start latency;
- crawl duration;
- pages fetched;
- PDFs discovered/downloaded;
- duplicate count;
- terminal status;
- library hit after crawl yes/no.

Do not log bearer tokens or full PDF bytes.

## 19. Testing strategy

### Scrapling unit/repository tests
- direct PDF vs ephemeral page classification;
- private/loopback URL rejection;
- path-scope enforcement;
- atomic active-URL dedupe;
- 30-minute success cooldown;
- 5-minute failure cooldown;
- search job limits cannot exceed hard caps;
- terminal status/progress persistence.

### Worker API tests
- bearer token required;
- safe candidate enqueues;
- invalid/private candidate returns 400;
- duplicate active candidate reuses job;
- job status contract remains compatible.

### Frontend unit tests
- no crawl when library has a hit;
- crawl starts on zero library results;
- at most three candidates;
- crawler failure does not erase web results;
- status route never exposes token;
- terminal status refreshes local library;
- new library result replaces matching web result.

### UI tests
- queued/running/success/no-hit/unavailable states;
- progress counters update;
- polling stops on terminal state;
- polling does not enqueue another crawl.

### Production smoke corpus
Use the W3C archived HTML 4.0 page already used for Scrapling acceptance because it contains a deterministic PDF link and has a known safe crawl scope.

## 20. Deployment sequence

1. Keep current Vercel production untouched.
2. Create `frontend/` source in `crawler-mvp` reproducing current production UI/API behavior.
3. Add parity tests and build checks.
4. Add Scrapling search-discovery API via TDD.
5. Deploy Scrapling update to Railway and run protected production smoke test.
6. Add Vercel crawler client/orchestrator/status route via TDD.
7. Add crawl-progress UI.
8. Deploy repository frontend to Vercel Preview.
9. Acceptance test existing library search, web search, auto-crawl, live progress, newly ingested download, and crawler-unavailable fallback.
10. Only after preview acceptance, connect/cut over the production Vercel project.
11. Keep the previous production deployment as immediate rollback candidate during observation.

## 21. Acceptance criteria

The phase is complete only when all are true:

1. A known library query returns without creating a crawl job.
2. A zero-library-result query returns web candidates immediately and starts no more than three bounded jobs.
3. Browser source/network traffic never contains the crawler bearer token.
4. The progress UI shows real worker counters while crawling.
5. A deterministic W3C test discovers/downloads the known PDF and the UI refreshes it into the local-library section.
6. Repeating the same search while its crawl is active reuses jobs rather than duplicating them.
7. Repeating the same candidate within the cooldown does not recrawl.
8. Private/localhost targets are rejected by Scrapling.
9. Worker/SearXNG failure leaves the basic search experience usable.
10. Existing `/api/library/file` downloads still work.
11. Frontend and Scrapling automated tests pass.
12. Vercel Preview acceptance passes before production alias cutover.

## 22. Rollback

Until production cutover, rollback is simply “do nothing”: the current Vercel production deployment remains live.

After cutover, rollback is:
1. promote the previous READY Vercel deployment;
2. leave the Scrapling backend deployed but stop new search-triggered calls;
3. no database rollback is required because new schema changes are additive and stored PDFs remain valid library entries.

## 23. Future extensions

After this phase is stable, the same job/status channel can support:
- “继续深度查找” user-controlled second pass;
- permanent promotion of high-value official domains into `seed_sites`;
- document metadata extraction with PyMuPDF;
- OCR for scanned standards;
- full-text indexing and RAG;
- query-aware crawl prioritization based on document numbers and titles.

These are intentionally excluded from the first search-miss auto-crawl release.
