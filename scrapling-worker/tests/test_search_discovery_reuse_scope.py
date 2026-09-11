import pytest

from app.repository import Repository


RUNNING_JOB = {
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


class ScopeDb:
    def __init__(self, responses):
        self.calls = []
        self.responses = list(responses)

    async def fetch_one(self, sql, params=()):
        self.calls.append((sql, params))
        if not self.responses:
            raise AssertionError(f"unexpected query: {sql}")
        return self.responses.pop(0)


def assert_ephemeral_scope(sql: str):
    compact = " ".join(sql.split()).lower()
    assert "seed_site_id is null" in compact
    assert "trigger_type='discovery'" in compact


@pytest.mark.asyncio
async def test_active_reuse_only_matches_ephemeral_discovery_jobs():
    db = ScopeDb([RUNNING_JOB])
    repo = Repository(db)

    job = await repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    )

    assert job["reused"] is True
    assert_ephemeral_scope(db.calls[0][0])


@pytest.mark.asyncio
async def test_recent_success_reuse_only_matches_ephemeral_discovery_jobs():
    succeeded = {**RUNNING_JOB, "id": "22222222-2222-2222-2222-222222222222", "status": "succeeded"}
    db = ScopeDb([None, succeeded])
    repo = Repository(db)

    job = await repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    )

    assert job["reused"] is True
    assert_ephemeral_scope(db.calls[1][0])


@pytest.mark.asyncio
async def test_recent_failure_reuse_only_matches_ephemeral_discovery_jobs():
    failed = {**RUNNING_JOB, "id": "33333333-3333-3333-3333-333333333333", "status": "failed"}
    db = ScopeDb([None, None, failed])
    repo = Repository(db)

    job = await repo.claim_search_discovery_job(
        normalized_url="https://example.gov/docs/notice",
        start_url="https://example.gov/docs/notice",
    )

    assert job["reused"] is True
    assert_ephemeral_scope(db.calls[2][0])
