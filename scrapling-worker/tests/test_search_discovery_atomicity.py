from contextlib import asynccontextmanager

import pytest

from app.repository import Repository


class TransactionDb:
    def __init__(self):
        self.transaction_calls = 0
        self.calls = []

    @asynccontextmanager
    async def transaction(self):
        self.transaction_calls += 1
        yield self

    async def fetch_one(self, sql, params=()):
        self.calls.append((sql, params))
        if "pg_advisory_xact_lock" in sql:
            return {"locked": None}
        if "status IN ('queued','running')" in sql:
            return {
                "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "seed_site_id": None,
                "trigger_type": "discovery",
                "start_url": "https://example.gov/docs/notice",
                "status": "running",
                "pages_fetched": 1,
                "files_discovered": 0,
                "files_downloaded": 0,
                "duplicates_found": 0,
                "errors_count": 0,
                "error_summary": None,
            }
        raise AssertionError(f"unexpected query: {sql}")


@pytest.mark.asyncio
async def test_search_discovery_claim_uses_transaction_scoped_advisory_lock():
    db = TransactionDb()
    repo = Repository(db)

    job = await repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    )

    assert job["reused"] is True
    assert db.transaction_calls == 1
    assert "pg_advisory_xact_lock" in db.calls[0][0]
    assert db.calls[0][1] == ("https://example.gov/docs/notice",)
