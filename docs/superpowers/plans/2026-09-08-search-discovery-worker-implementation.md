# Search Discovery Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected, bounded, deduplicated Scrapling `search-discovery` job path that can safely ingest direct PDFs or crawl tightly scoped public HTML candidates after a PDF Finder library miss.

**Architecture:** Reuse the existing FastAPI + in-memory `CrawlerJobs` queue and PostgreSQL persistence. Search-triggered jobs use `trigger_type='discovery'`, have no permanent `seed_sites` row, derive a temporary crawl policy from the candidate URL, and are deduplicated by normalized start URL with active/recent cooldown rules. Existing seed crawling and direct `/v1/ingest` behavior remain compatible.

**Tech Stack:** Python 3.12, Scrapling, FastAPI/Uvicorn, PostgreSQL, httpx, pytest, GitHub Actions, Railway.

**Spec:** `docs/superpowers/specs/2026-09-08-search-miss-auto-crawl-design.md`

## Global Constraints

- Search-triggered crawl starts only from a server-selected public HTTP(S) candidate URL.
- Browser clients never receive or send `CRAWLER_API_TOKEN` directly to Railway.
- Search-triggered limits: max 20 pages/job, max 10 PDFs/job, max depth 2, max runtime 120 seconds, concurrency 1 per host, max 3 dynamic pages/job.
- Recursive HTML remains limited to candidate host + derived path scope.
- External directly linked PDF attachments may be downloaded only after provenance/SSRF validation; external HTML is never recursively crawled.
- Existing hard safety limits remain authoritative and may be stricter.
- Reuse an active identical URL job; reuse successful/partial terminal jobs for 30 minutes; failed-job retry cooldown is 5 minutes.
- Schema migrations must be additive. Do not delete existing documents, seeds, jobs, or blobs.
- Existing `/v1/crawl/jobs`, `/v1/ingest`, seed scheduler, startup orphan recovery, SHA256 dedupe, and public library endpoints must continue to pass their tests.

---

## File Structure

**Modify**
- `scrapling-worker/app/repository.py` — normalized URL job lookup/claim and cooldown rules.
- `scrapling-worker/app/jobs.py` — new queued mode for ephemeral search-discovery execution.
- `scrapling-worker/app/api.py` — protected `POST /v1/search-discovery/jobs` contract.
- `scrapling-worker/app/config.py` — fixed search-discovery caps if settings are needed for observability/testing.
- `scrapling-worker/app/url_policy.py` — public candidate validation helpers; preserve private-network blocking.
- `scrapling-worker/app/link_policy.py` — reuse path-scope semantics if required, no broad-site fallback.
- `scrapling-worker/DEPLOYMENT_STATUS.md` — production verification evidence after deployment.

**Create**
- `scrapling-worker/migrations/004_search_discovery.sql` — additive normalized URL / created-at indexes.
- `scrapling-worker/app/search_discovery.py` — focused candidate normalization/classification + ephemeral policy construction.
- `scrapling-worker/tests/test_search_discovery_policy.py` — candidate and scope unit tests.
- `scrapling-worker/tests/test_search_discovery_jobs.py` — queue/execution/cooldown tests.

**Extend tests**
- `scrapling-worker/tests/test_repository_contract.py`
- `scrapling-worker/tests/test_api_contract.py`
- `scrapling-worker/tests/test_jobs.py`

---

### Task 1: Add additive search-job schema and repository deduplication

**Files:**
- Create: `scrapling-worker/migrations/004_search_discovery.sql`
- Modify: `scrapling-worker/app/repository.py`
- Test: `scrapling-worker/tests/test_repository_contract.py`

**Interfaces:**
- Consumes: existing `normalize_url(url: str) -> str` from `app.pdf_store` for canonical start URLs.
- Produces: `Repository.claim_search_discovery_job(*, normalized_url: str, start_url: str) -> dict` returning the existing job shape plus `reused: bool`.

- [ ] **Step 1: Write failing repository tests for active/recent reuse**

Add tests that drive the repository with the existing fake DB recorder and require these SQL semantics:

```python
import asyncio


def test_claim_search_discovery_job_reuses_active_job():
    db = FakeDb(
        fetch_one_results=[{
            "id": "11111111-1111-1111-1111-111111111111",
            "seed_site_id": None,
            "trigger_type": "discovery",
            "start_url": "https://example.gov/docs/notice",
            "status": "running",
            "pages_fetched": 3,
            "files_discovered": 0,
            "files_downloaded": 0,
            "duplicates_found": 0,
            "errors_count": 0,
            "error_summary": None,
        }]
    )
    repo = Repository(db)
    job = asyncio.run(repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    ))
    assert job["id"] == "11111111-1111-1111-1111-111111111111"
    assert job["reused"] is True
    assert any("status IN ('queued','running')" in sql for sql, _ in db.fetch_one_calls)


def test_claim_search_discovery_job_inserts_when_no_reusable_job():
    db = FakeDb(fetch_one_results=[None, None, None, {
        "id": "22222222-2222-2222-2222-222222222222",
        "seed_site_id": None,
        "trigger_type": "discovery",
        "start_url": "https://example.gov/docs/notice",
        "status": "queued",
        "pages_fetched": 0,
        "files_discovered": 0,
        "files_downloaded": 0,
        "duplicates_found": 0,
        "errors_count": 0,
        "error_summary": None,
    }])
    repo = Repository(db)
    job = asyncio.run(repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    ))
    assert job["reused"] is False
    assert any("INSERT INTO crawl_jobs" in sql for sql, _ in db.fetch_one_calls)
```

Also assert a success/partial query uses a 30-minute interval and failed-job reuse uses a 5-minute interval.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd scrapling-worker
python -m pytest tests/test_repository_contract.py -q
```

Expected: FAIL because `claim_search_discovery_job` and new schema semantics do not exist.

- [ ] **Step 3: Add additive migration**

Create `004_search_discovery.sql`:

```sql
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
```

Do not add a destructive uniqueness constraint because historical duplicates already exist and active claim logic must be compatible with the live database.

- [ ] **Step 4: Implement repository claim logic**

Add a method with this public signature:

```python
async def claim_search_discovery_job(self, *, normalized_url: str, start_url: str):
    active = await self.db.fetch_one(
        """
        SELECT * FROM crawl_jobs
        WHERE normalized_start_url=%s
          AND status IN ('queued','running')
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (normalized_url,),
    )
    if active:
        job = self._job(active)
        job["reused"] = True
        return job

    recent_ok = await self.db.fetch_one(
        """
        SELECT * FROM crawl_jobs
        WHERE normalized_start_url=%s
          AND status IN ('succeeded','partial')
          AND created_at >= now() - interval '30 minutes'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (normalized_url,),
    )
    if recent_ok:
        job = self._job(recent_ok)
        job["reused"] = True
        return job

    recent_failed = await self.db.fetch_one(
        """
        SELECT * FROM crawl_jobs
        WHERE normalized_start_url=%s
          AND status='failed'
          AND created_at >= now() - interval '5 minutes'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (normalized_url,),
    )
    if recent_failed:
        job = self._job(recent_failed)
        job["reused"] = True
        return job

    row = await self.db.fetch_one(
        """
        INSERT INTO crawl_jobs
          (seed_site_id, trigger_type, start_url, normalized_start_url, status)
        VALUES (NULL, 'discovery', %s, %s, 'queued')
        RETURNING *
        """,
        (start_url, normalized_url),
    )
    job = self._job(row)
    job["reused"] = False
    return job
```

Keep `_job()` backwards compatible; adding `reused` is done only by this method so existing endpoints are unchanged.

- [ ] **Step 5: Run repository tests GREEN**

```bash
cd scrapling-worker
python -m pytest tests/test_repository_contract.py -q
```

Expected: PASS.

- [ ] **Step 6: Run complete worker test suite**

```bash
cd scrapling-worker
python -m pytest -q --cache-clear
python -m compileall -q app
```

Expected: all current tests plus new repository tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add scrapling-worker/migrations/004_search_discovery.sql \
        scrapling-worker/app/repository.py \
        scrapling-worker/tests/test_repository_contract.py
git commit -m "feat(scrapling): dedupe search discovery jobs"
```

---

### Task 2: Build safe ephemeral candidate policy

**Files:**
- Create: `scrapling-worker/app/search_discovery.py`
- Create: `scrapling-worker/tests/test_search_discovery_policy.py`
- Modify only if needed: `scrapling-worker/app/url_policy.py`, `scrapling-worker/app/link_policy.py`

**Interfaces:**
- Produces: `build_search_candidate(url: str) -> SearchCandidate`.
- Produces dataclass fields: `url`, `normalized_url`, `host`, `start_url`, `allowed_hosts`, `max_depth=2`, `max_pages=20`, `max_pdfs=10`, `max_job_seconds=120`, `max_concurrency=1`, `max_dynamic_pages=3`.
- Produces: `SearchCandidate.is_direct_pdf_hint: bool`.
- Uses existing network request safety again at download/fetch time; policy construction never bypasses `url_policy`.

- [ ] **Step 1: Write failing policy tests**

Create tests with exact expectations:

```python
import pytest
from app.search_discovery import build_search_candidate


def test_directory_candidate_keeps_subtree_scope():
    candidate = build_search_candidate("https://example.gov/notices/2026/")
    assert candidate.host == "example.gov"
    assert candidate.allowed_hosts == {"example.gov"}
    assert candidate.max_depth == 2
    assert candidate.max_pages == 20
    assert candidate.max_pdfs == 10
    assert candidate.max_job_seconds == 120
    assert candidate.max_concurrency == 1
    assert candidate.max_dynamic_pages == 3


def test_file_candidate_uses_parent_directory_as_scope_anchor():
    candidate = build_search_candidate("https://example.gov/notices/2026/detail.html")
    assert candidate.scope_url == "https://example.gov/notices/2026/"


def test_extensionless_candidate_does_not_expand_to_site_root():
    candidate = build_search_candidate("https://example.gov/notices/12345")
    assert candidate.scope_url == "https://example.gov/notices/12345"

@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "ftp://example.gov/file.pdf",
    "https://user:pass@example.gov/a.pdf",
    "http://localhost/a.pdf",
    "http://127.0.0.1/a.pdf",
])
def test_unsafe_candidate_rejected(url):
    with pytest.raises(ValueError):
        build_search_candidate(url)
```

The localhost/private-address tests may use the existing deterministic hostname/IP rejection helper rather than live DNS.

- [ ] **Step 2: Run policy tests RED**

```bash
cd scrapling-worker
python -m pytest tests/test_search_discovery_policy.py -q
```

Expected: import/function failures.

- [ ] **Step 3: Implement immutable search candidate policy**

Create a focused dataclass and builder:

```python
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit
from .pdf_store import normalize_url

_FILE_SUFFIXES = {".html", ".htm", ".shtml", ".asp", ".aspx", ".jsp", ".php"}

@dataclass(frozen=True)
class SearchCandidate:
    url: str
    normalized_url: str
    host: str
    scope_url: str
    allowed_hosts: set[str]
    max_depth: int = 2
    max_pages: int = 20
    max_pdfs: int = 10
    max_job_seconds: int = 120
    max_concurrency: int = 1
    max_dynamic_pages: int = 3
    is_direct_pdf_hint: bool = False


def build_search_candidate(url: str) -> SearchCandidate:
    value = url.strip()
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("only public HTTP(S) candidate URLs without credentials are allowed")
    host = parsed.hostname.lower()
    # Call/reuse the existing deterministic public-host validation helper here.
    # Do not perform a permissive fallback when validation fails.
    validate_public_candidate_host(host)

    path = parsed.path or "/"
    suffix = next((s for s in _FILE_SUFFIXES if path.lower().endswith(s)), None)
    if path.endswith("/"):
        scope_path = path
    elif suffix:
        scope_path = path.rsplit("/", 1)[0] + "/"
    else:
        scope_path = path
    scope_url = urlunsplit((parsed.scheme, parsed.netloc, scope_path, "", ""))
    direct = path.lower().endswith(".pdf") or "/download" in path.lower() or "/attachment" in path.lower()
    return SearchCandidate(
        url=value,
        normalized_url=normalize_url(value),
        host=host,
        scope_url=scope_url,
        allowed_hosts={host},
        is_direct_pdf_hint=direct,
    )
```

Implement `validate_public_candidate_host()` by reusing the existing `url_policy` private/loopback rules; do not duplicate a weaker network-policy implementation.

- [ ] **Step 4: Run policy tests GREEN and existing URL-policy tests**

```bash
cd scrapling-worker
python -m pytest tests/test_search_discovery_policy.py tests/test_url_pdf.py tests/test_spider_logic.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add scrapling-worker/app/search_discovery.py \
        scrapling-worker/app/url_policy.py \
        scrapling-worker/app/link_policy.py \
        scrapling-worker/tests/test_search_discovery_policy.py
git commit -m "feat(scrapling): add bounded search discovery policy"
```

Only stage `url_policy.py`/`link_policy.py` if they actually changed.

---

### Task 3: Add ephemeral search-discovery queue mode and execution

**Files:**
- Modify: `scrapling-worker/app/jobs.py`
- Test: `scrapling-worker/tests/test_search_discovery_jobs.py`
- Test: `scrapling-worker/tests/test_jobs.py`

**Interfaces:**
- Produces: `CrawlerJobs.enqueue_search_discovery(url: str) -> dict`.
- Adds queued mode string: `"search-discovery"`.
- Reuses existing `PdfDiscoverySpider`, `download_pdf`, `persist_pdf`, job progress counters, and terminal statuses.
- Search-discovery jobs have `seed_site_id=None` and do not read/write `seed_sites`.

- [ ] **Step 1: Write failing enqueue/dedupe tests**

```python
import asyncio
from types import SimpleNamespace
from app.jobs import CrawlerJobs


class SearchRepo:
    def __init__(self):
        self.claims = []
    async def claim_search_discovery_job(self, *, normalized_url, start_url):
        self.claims.append((normalized_url, start_url))
        return {
            "id": "33333333-3333-3333-3333-333333333333",
            "seedSiteId": None,
            "triggerType": "discovery",
            "startUrl": start_url,
            "status": "queued",
            "pagesFetched": 0,
            "filesDiscovered": 0,
            "filesDownloaded": 0,
            "duplicatesFound": 0,
            "errorsCount": 0,
            "errorSummary": None,
            "reused": False,
        }


def test_enqueue_search_discovery_claims_and_queues_new_job():
    repo = SearchRepo()
    jobs = CrawlerJobs(repo, SimpleNamespace())
    job = asyncio.run(jobs.enqueue_search_discovery("https://example.gov/notices/123"))
    assert job["reused"] is False
    queued = jobs.queue.get_nowait()
    assert queued.mode == "search-discovery"
    assert queued.seed is None


def test_enqueue_search_discovery_does_not_requeue_reused_job():
    repo = SearchRepo()
    async def reused(**kwargs):
        row = await SearchRepo().claim_search_discovery_job(**kwargs)
        row["reused"] = True
        row["status"] = "running"
        return row
    repo.claim_search_discovery_job = reused
    jobs = CrawlerJobs(repo, SimpleNamespace())
    job = asyncio.run(jobs.enqueue_search_discovery("https://example.gov/notices/123"))
    assert job["reused"] is True
    assert jobs.queue.empty()
```

- [ ] **Step 2: Write failing execution-limit test**

Monkeypatch `PdfDiscoverySpider` and assert the search mode constructs it with exactly:

```python
assert kwargs["max_depth"] == 2
assert kwargs["max_pages"] == 20
assert kwargs["max_pdfs"] == 10
assert kwargs["max_concurrency"] == 1
assert kwargs["max_dynamic_pages"] == 3
assert kwargs["allowed_hosts"] == {"example.gov"}
```

For a direct `.pdf` candidate, assert the job uses `download_pdf()` directly and does not instantiate `PdfDiscoverySpider`.

- [ ] **Step 3: Run focused tests RED**

```bash
cd scrapling-worker
python -m pytest tests/test_search_discovery_jobs.py -q
```

Expected: FAIL because queue mode and execution method do not exist.

- [ ] **Step 4: Extend `QueuedJob` safely**

Change the dataclass to permit ephemeral jobs without a Seed row:

```python
@dataclass
class QueuedJob:
    job_id: str
    mode: str
    seed: dict | None
    start_url: str
    referrer_url: str | None = None
```

Existing `seed` and `ingest` paths must still receive real Seed dictionaries.

- [ ] **Step 5: Implement `enqueue_search_discovery()`**

```python
async def enqueue_search_discovery(self, url: str):
    candidate = build_search_candidate(url)
    job = await self.repo.claim_search_discovery_job(
        normalized_url=candidate.normalized_url,
        start_url=candidate.url,
    )
    if not job.get("reused") and job["status"] == "queued":
        await self.queue.put(QueuedJob(job["id"], "search-discovery", None, candidate.url))
    return job
```

- [ ] **Step 6: Implement direct-PDF and page-crawl execution**

In `_execute()` dispatch the new mode:

```python
if item.mode == "search-discovery":
    return await self._run_search_discovery(item)
```

`_run_search_discovery()` must:
1. rebuild and validate the `SearchCandidate` from `item.start_url`;
2. if `is_direct_pdf_hint`, download with `{candidate.host}` plus redirect/public-network revalidation and persist with existing helpers;
3. otherwise instantiate `PdfDiscoverySpider` with candidate hard limits and `start_url=item.start_url`, using `scope_url` semantics from `SearchCandidate`;
4. persist page/PDF progress after each stream item exactly like `_run_seed()`;
5. wrap only this mode in `asyncio.timeout(candidate.max_job_seconds)` = 120 seconds;
6. return `succeeded`, `partial`, or `failed` under the same semantics as seed jobs.

Extract shared page/PDF stream persistence only if necessary to avoid copying large blocks; do not restructure unrelated scheduler code.

- [ ] **Step 7: Run focused and regression tests GREEN**

```bash
cd scrapling-worker
python -m pytest tests/test_search_discovery_jobs.py tests/test_jobs.py tests/test_spider_logic.py -q
python -m pytest -q --cache-clear
python -m compileall -q app
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add scrapling-worker/app/jobs.py \
        scrapling-worker/tests/test_search_discovery_jobs.py \
        scrapling-worker/tests/test_jobs.py
git commit -m "feat(scrapling): execute ephemeral search discovery jobs"
```

---

### Task 4: Add protected `POST /v1/search-discovery/jobs` API

**Files:**
- Modify: `scrapling-worker/app/api.py`
- Test: `scrapling-worker/tests/test_api_contract.py`

**Interfaces:**
- Consumes: `CrawlerJobs.enqueue_search_discovery(url: str) -> dict`.
- Produces protected endpoint response: `{ "job": { ..., "reused": bool } }` with HTTP 202 for new/reused valid jobs.
- Input contract: `{ "url": string, "query": string?, "mode": "auto"? }`.

- [ ] **Step 1: Write failing auth/validation/API tests**

Add tests using the existing FastAPI `TestClient` fixture pattern:

```python
def test_search_discovery_requires_bearer_token(client):
    response = client.post("/v1/search-discovery/jobs", json={"url": "https://example.gov/a"})
    assert response.status_code == 401


def test_search_discovery_rejects_invalid_scheme(authorized_client):
    response = authorized_client.post("/v1/search-discovery/jobs", json={"url": "file:///etc/passwd"})
    assert response.status_code == 400


def test_search_discovery_enqueues_public_candidate(authorized_client, jobs):
    response = authorized_client.post(
        "/v1/search-discovery/jobs",
        json={"url": "https://example.gov/notices/123", "query": "156号", "mode": "auto"},
    )
    assert response.status_code == 202
    assert response.json()["job"]["startUrl"] == "https://example.gov/notices/123"
```

Also assert a 200-character query is accepted, a >200-character query returns 400, and unknown `mode` values return 400.

- [ ] **Step 2: Run API tests RED**

```bash
cd scrapling-worker
python -m pytest tests/test_api_contract.py -q
```

Expected: 404 for missing route and/or validation failures.

- [ ] **Step 3: Implement endpoint without exposing policy knobs**

Add before seed-management routes:

```python
@app.post("/v1/search-discovery/jobs")
async def create_search_discovery_job(request: Request):
    body = await request.json()
    if not isinstance(body, dict):
        return _json(400, {"error": "JSON object required"})
    source_url = body.get("url")
    query = body.get("query", "")
    mode = body.get("mode", "auto")
    if not isinstance(source_url, str) or not source_url.strip():
        return _json(400, {"error": "url is required"})
    if not isinstance(query, str) or len(query) > 200:
        return _json(400, {"error": "query must be <= 200 characters"})
    if mode != "auto":
        return _json(400, {"error": "mode must be auto"})
    try:
        job = await jobs.enqueue_search_discovery(source_url.strip())
    except ValueError as exc:
        return _json(400, {"error": str(exc)})
    return _json(202, {"job": job})
```

Do **not** accept `allowedHosts`, concurrency, depth, max pages, timeout, or dynamic caps from this body.

- [ ] **Step 4: Run API + full tests GREEN**

```bash
cd scrapling-worker
python -m pytest tests/test_api_contract.py tests/test_search_discovery_policy.py tests/test_search_discovery_jobs.py -q
python -m pytest -q --cache-clear
python -m compileall -q app
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add scrapling-worker/app/api.py scrapling-worker/tests/test_api_contract.py
git commit -m "feat(scrapling): expose protected search discovery jobs"
```

---

### Task 5: Production deploy and protected W3C smoke verification

**Files:**
- Modify: `scrapling-worker/DEPLOYMENT_STATUS.md`
- No production frontend files changed in this task.

**Interfaces:**
- Railway service remains `crawler-worker`, root `scrapling-worker`, port 3001, `/health`.
- Protected smoke candidate: `https://www.w3.org/TR/REC-html40-971218/`.
- Expected deterministic PDF: the archived HTML 4.0 PDF already accepted in prior smoke runs.

- [ ] **Step 1: Verify GitHub Actions for the final worker commit**

Expected CI gates:

```text
pytest: PASS
compileall: PASS
scrapling dynamic verification: PASS
```

Do not deploy a RED commit.

- [ ] **Step 2: Force a fresh Railway build from the exact worker commit**

Set the existing `SCRAPLING_BUILD_SHA` variable to the final commit SHA with deployment enabled. Do not use a stale Railway `redeploy` snapshot.

- [ ] **Step 3: Verify Railway deployment and health**

Acceptance:

```text
latest crawler-worker deployment = SUCCESS
GET /health = 200 {"ok":true}
```

- [ ] **Step 4: Run protected new-endpoint smoke against W3C**

Request server-side with the existing secret token:

```http
POST /v1/search-discovery/jobs
Authorization: Bearer <server secret>
Content-Type: application/json

{
  "url": "https://www.w3.org/TR/REC-html40-971218/",
  "query": "HTML 4.0",
  "mode": "auto"
}
```

Poll `GET /v1/crawl/jobs/{id}` until terminal.

Expected:
- request returns 202;
- `seedSiteId` is null;
- `triggerType` is `discovery`;
- pages increase while running;
- at least 1 PDF is discovered/downloaded or dedupe-hit against the existing corpus;
- final status is `succeeded` or `partial` only for a bounded recoverable fetch issue;
- no `NoneType.xpath`, `.decl/.dtd` parser regression, private-network request, or unbounded `/TR/` crawl appears in logs.

- [ ] **Step 5: Repeat same request to verify cooldown reuse**

Immediately repeat the same POST. Expected:

```json
{
  "job": {
    "id": "<same recent job id>",
    "reused": true
  }
}
```

No second W3C crawl should start.

- [ ] **Step 6: Update deployment status evidence**

Append exact commit, Railway deployment ID, smoke job ID, terminal counters, and cooldown-reuse verification to `scrapling-worker/DEPLOYMENT_STATUS.md`.

- [ ] **Step 7: Commit status evidence**

```bash
git add scrapling-worker/DEPLOYMENT_STATUS.md
git commit -m "docs(scrapling): record search discovery production acceptance"
```

---

## Plan Self-Review Result

- Spec coverage: worker-side sections 7–11, 16–19, deployment gate, cooldown, SSRF, progress, and W3C acceptance are mapped to Tasks 1–5.
- No destructive migration or permanent Seed creation is included.
- No browser-facing secret or user-controlled safety cap is introduced.
- `seed_site_id=None` and `trigger_type='discovery'` are consistent across repository, queue, API, and smoke tasks.
- Search-discovery hard limits are identical in every task: 20 pages, 10 PDFs, depth 2, 120 seconds, concurrency 1, 3 dynamic pages.
- Existing seed scheduler and `/v1/ingest` paths remain regression-tested.
