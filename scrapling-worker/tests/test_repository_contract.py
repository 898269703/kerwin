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
        if "FROM document_blobs" in sql:
            return {"content": b"%PDF-blob"}
        return None

    async def execute(self, sql, params=()):
        self.calls.append(("execute", sql, params))


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
