import pytest

from app.repository import Repository


class FakeDb:
    def __init__(self):
        self.calls = []

    async def fetch_all(self, sql, params=()):
        self.calls.append(("fetch_all", sql, params))
        if "FROM documents d" in sql:
            return [{
                "id": "doc-1",
                "sha256": "a" * 64,
                "storage_key": "pdfs/aa/bb/file.pdf",
                "mime_type": "application/pdf",
                "byte_size": 42,
                "preferred_title": "国家电网财〔2014〕156号",
                "preferred_filename": "156.pdf",
                "document_number": "国家电网财〔2014〕156号",
                "score": 1.0,
                "source_count": 2,
            }]
        if "FROM seed_sites s" in sql:
            return [{
                "id": "seed-due",
                "name": "Due seed",
                "base_url": "https://example.com/docs/",
                "allowed_hosts": ["example.com"],
                "include_patterns": [],
                "exclude_patterns": [],
                "max_depth": 2,
                "max_requests_per_minute": 30,
                "max_concurrency": 1,
                "max_pdf_bytes": 10_485_760,
                "crawl_interval_minutes": 60,
                "enabled": True,
            }]
        return []

    async def fetch_one(self, sql, params=()):
        self.calls.append(("fetch_one", sql, params))
        if "document_blobs" in sql:
            return {
                "id": "doc-1",
                "preferred_title": "156.pdf",
                "preferred_filename": "156.pdf",
                "content": b"%PDF-blob",
            }
        if "INSERT INTO crawl_jobs" in sql and "NOT EXISTS" in sql:
            return {
                "id": "job-1",
                "seed_site_id": "seed-due",
                "trigger_type": "seed",
                "start_url": "https://example.com/docs/",
                "status": "queued",
            }
        if "UPDATE seed_sites" in sql and "RETURNING" in sql:
            return {
                "id": "seed-due",
                "name": "Due seed",
                "base_url": "https://example.com/docs/",
                "allowed_hosts": ["example.com"],
                "include_patterns": [],
                "exclude_patterns": [],
                "max_depth": 2,
                "max_requests_per_minute": 30,
                "max_concurrency": 1,
                "max_pdf_bytes": 10_485_760,
                "crawl_interval_minutes": 120,
                "enabled": False,
            }
        return None

    async def execute(self, sql, params=()):
        self.calls.append(("execute", sql, params))


class SeedDedupeDb(FakeDb):
    def __init__(self):
        super().__init__()
        self.existing = {
            "id": "seed-1",
            "name": "W3C HTML 4.0 Test",
            "base_url": "https://www.w3.org/TR/REC-html40-971218/",
            "allowed_hosts": ["www.w3.org"],
            "include_patterns": [],
            "exclude_patterns": [],
            "max_depth": 4,
            "max_requests_per_minute": 30,
            "max_concurrency": 1,
            "max_pdf_bytes": 10_485_760,
            "crawl_interval_minutes": 0,
            "enabled": True,
        }

    async def fetch_one(self, sql, params=()):
        self.calls.append(("fetch_one", sql, params))
        if "FROM seed_sites" in sql and "base_url" in sql:
            return self.existing
        if "INSERT INTO seed_sites" in sql:
            raise AssertionError("duplicate seed must not be inserted")
        return await super().fetch_one(sql, params)


class SearchDiscoveryDb(FakeDb):
    def __init__(self, fetch_one_results):
        super().__init__()
        self.fetch_one_results = list(fetch_one_results)

    async def fetch_one(self, sql, params=()):
        self.calls.append(("fetch_one", sql, params))
        if not self.fetch_one_results:
            raise AssertionError(f"unexpected fetch_one: {sql}")
        return self.fetch_one_results.pop(0)


def discovery_job(job_id: str, status: str):
    return {
        "id": job_id,
        "seed_site_id": None,
        "trigger_type": "discovery",
        "start_url": "https://example.gov/docs/notice",
        "status": status,
        "pages_fetched": 3 if status == "running" else 0,
        "files_discovered": 0,
        "files_downloaded": 0,
        "duplicates_found": 0,
        "errors_count": 0,
        "error_summary": None,
    }


@pytest.mark.asyncio
async def test_search_documents_preserves_library_shape():
    repo = Repository(FakeDb())
    rows = await repo.search_documents("国家电网财〔2014〕156号", 20)
    assert rows[0]["id"] == "doc-1"
    assert rows[0]["documentNumber"] == "国家电网财〔2014〕156号"
    assert rows[0]["sourceCount"] == 2
    assert rows[0]["score"] == 1.0


@pytest.mark.asyncio
async def test_document_blob_is_returned_as_bytes():
    repo = Repository(FakeDb())
    blob = await repo.get_document_blob("doc-1")
    assert blob["content"] == b"%PDF-blob"


@pytest.mark.asyncio
async def test_upsert_blob_marks_storage_hybrid():
    db = FakeDb()
    repo = Repository(db)
    await repo.upsert_document_blob("doc-1", "a" * 64, b"%PDF-test")
    sql_text = "\n".join(call[1] for call in db.calls)
    assert "INSERT INTO document_blobs" in sql_text
    assert "storage_backend='hybrid'" in sql_text


@pytest.mark.asyncio
async def test_worker_restart_marks_interrupted_and_orphaned_jobs_failed():
    db = FakeDb()
    repo = Repository(db)

    await repo.fail_interrupted_jobs()

    execute_calls = [call for call in db.calls if call[0] == "execute"]
    assert len(execute_calls) == 1
    _, sql, params = execute_calls[0]
    compact_sql = " ".join(sql.split()).lower()
    assert "status='failed'" in compact_sql
    assert "finished_at=now()" in compact_sql
    assert "queued" in compact_sql
    assert "running" in compact_sql
    assert "worker restarted before completion" in params


@pytest.mark.asyncio
async def test_create_seed_reuses_existing_base_url_ignoring_trailing_slash():
    db = SeedDedupeDb()
    repo = Repository(db)

    seed = await repo.create_seed_site({
        "name": "duplicate",
        "baseUrl": "https://www.w3.org/TR/REC-html40-971218",
        "allowedHosts": ["www.w3.org"],
        "maxDepth": 4,
        "maxRequestsPerMinute": 30,
        "maxConcurrency": 1,
        "maxPdfBytes": 10_485_760,
        "crawlIntervalMinutes": 60,
    })

    assert seed["id"] == "seed-1"
    assert seed["crawlIntervalMinutes"] == 0
    assert not any(call[0] == "fetch_one" and "INSERT INTO seed_sites" in call[1] for call in db.calls)


@pytest.mark.asyncio
async def test_due_seed_query_excludes_active_jobs_and_honors_interval():
    db = FakeDb()
    repo = Repository(db)

    seeds = await repo.list_due_seed_sites(limit=10)

    assert seeds[0]["id"] == "seed-due"
    assert seeds[0]["crawlIntervalMinutes"] == 60
    _, sql, params = next(call for call in db.calls if call[0] == "fetch_all" and "FROM seed_sites s" in call[1])
    compact = " ".join(sql.split()).lower()
    assert "crawl_interval_minutes > 0" in compact
    assert "status in ('queued','running')" in compact
    assert "make_interval" in compact
    assert params == (10,)


@pytest.mark.asyncio
async def test_idle_seed_job_creation_is_atomic():
    db = FakeDb()
    repo = Repository(db)

    job = await repo.create_crawl_job_if_idle("seed-due", "seed", "https://example.com/docs/")

    assert job["id"] == "job-1"
    _, sql, _ = next(call for call in db.calls if call[0] == "fetch_one" and "INSERT INTO crawl_jobs" in call[1])
    assert "NOT EXISTS" in sql
    assert "status IN ('queued','running')" in sql


@pytest.mark.asyncio
async def test_seed_policy_can_be_updated_without_deleting_history():
    db = FakeDb()
    repo = Repository(db)

    seed = await repo.update_seed_site("seed-due", enabled=False, crawl_interval_minutes=120)

    assert seed["enabled"] is False
    assert seed["crawlIntervalMinutes"] == 120
    _, sql, _ = next(call for call in db.calls if call[0] == "fetch_one" and "UPDATE seed_sites" in call[1])
    assert "DELETE" not in sql.upper()
    assert "updated_at=now()" in sql


@pytest.mark.asyncio
async def test_claim_search_discovery_job_reuses_active_job():
    db = SearchDiscoveryDb([discovery_job("11111111-1111-1111-1111-111111111111", "running")])
    repo = Repository(db)

    job = await repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    )

    assert job["id"] == "11111111-1111-1111-1111-111111111111"
    assert job["reused"] is True
    sql = db.calls[0][1]
    assert "status IN ('queued','running')" in sql


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["succeeded", "partial"])
async def test_claim_search_discovery_job_reuses_recent_success_or_partial(status):
    db = SearchDiscoveryDb([None, discovery_job("22222222-2222-2222-2222-222222222222", status)])
    repo = Repository(db)

    job = await repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    )

    assert job["reused"] is True
    recent_sql = db.calls[1][1]
    assert "status IN ('succeeded','partial')" in recent_sql
    assert "interval '30 minutes'" in recent_sql


@pytest.mark.asyncio
async def test_claim_search_discovery_job_reuses_recent_failure_for_five_minutes():
    db = SearchDiscoveryDb([None, None, discovery_job("33333333-3333-3333-3333-333333333333", "failed")])
    repo = Repository(db)

    job = await repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    )

    assert job["reused"] is True
    failed_sql = db.calls[2][1]
    assert "status='failed'" in failed_sql
    assert "interval '5 minutes'" in failed_sql


@pytest.mark.asyncio
async def test_claim_search_discovery_job_inserts_when_no_reusable_job():
    inserted = discovery_job("44444444-4444-4444-4444-444444444444", "queued")
    db = SearchDiscoveryDb([None, None, None, inserted])
    repo = Repository(db)

    job = await repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    )

    assert job["id"] == "44444444-4444-4444-4444-444444444444"
    assert job["reused"] is False
    insert_sql = db.calls[3][1]
    assert "INSERT INTO crawl_jobs" in insert_sql
    assert "normalized_start_url" in insert_sql
