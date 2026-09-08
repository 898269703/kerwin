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
            "enabled": True,
        }

    async def fetch_one(self, sql, params=()):
        self.calls.append(("fetch_one", sql, params))
        if "FROM seed_sites" in sql and "base_url" in sql:
            return self.existing
        if "INSERT INTO seed_sites" in sql:
            raise AssertionError("duplicate seed must not be inserted")
        return await super().fetch_one(sql, params)


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
async def test_worker_restart_marks_interrupted_running_jobs_failed():
    db = FakeDb()
    repo = Repository(db)

    await repo.fail_interrupted_jobs()

    execute_calls = [call for call in db.calls if call[0] == "execute"]
    assert len(execute_calls) == 1
    _, sql, params = execute_calls[0]
    assert "status='running'" in sql
    assert "status='failed'" in sql
    assert "finished_at=now()" in sql
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
    })

    assert seed["id"] == "seed-1"
    assert not any(call[0] == "fetch_one" and "INSERT INTO seed_sites" in call[1] for call in db.calls)
