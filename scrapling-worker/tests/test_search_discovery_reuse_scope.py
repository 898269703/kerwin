import pytest

from app.repository import Repository


class ScopeDb:
    def __init__(self):
        self.calls = []

    async def fetch_one(self, sql, params=()):
        self.calls.append((sql, params))
        if "status IN ('queued','running')" in sql:
            return {
                "id": "11111111-1111-1111-1111-111111111111",
                "seed_site_id": None,
                "trigger_type": "discovery",
                "start_url": "https://example.gov/docs/notice",
                "status": "running",
                "pages_fetched": 0,
                "files_discovered": 0,
                "files_downloaded": 0,
                "duplicates_found": 0,
                "errors_count": 0,
                "error_summary": None,
            }
        raise AssertionError(f"unexpected query: {sql}")


@pytest.mark.asyncio
async def test_reuse_query_only_matches_ephemeral_discovery_jobs():
    db = ScopeDb()
    repo = Repository(db)

    job = await repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    )

    assert job["reused"] is True
    sql = " ".join(db.calls[0][0].split()).lower()
    assert "seed_site_id is null" in sql
    assert "trigger_type='discovery'" in sql
