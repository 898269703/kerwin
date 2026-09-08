from types import SimpleNamespace

import pytest

import app.jobs as jobs_module
from app.jobs import CrawlerJobs


class Repo:
    def __init__(self):
        self.claims = []

    async def claim_search_discovery_job(self, *, normalized_url, start_url):
        self.claims.append((normalized_url, start_url))
        return {
            "id": "11111111-1111-1111-1111-111111111111",
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


@pytest.mark.asyncio
async def test_enqueue_search_discovery_resolves_candidate_before_claim(monkeypatch):
    checked = []

    async def fake_resolve(url, allowed_hosts):
        checked.append((url, allowed_hosts))
        return object()

    monkeypatch.setattr(jobs_module, "resolve_public_url", fake_resolve)
    repo = Repo()
    crawler = CrawlerJobs(repo, SimpleNamespace())

    await crawler.enqueue_search_discovery("https://example.gov/notices/123")

    assert checked == [("https://example.gov/notices/123", {"example.gov"})]
    assert len(repo.claims) == 1


@pytest.mark.asyncio
async def test_failed_dns_public_preflight_never_claims_job(monkeypatch):
    async def reject_private(_url, _allowed_hosts):
        raise ValueError("URL resolves to a non-public address")

    monkeypatch.setattr(jobs_module, "resolve_public_url", reject_private)
    repo = Repo()
    crawler = CrawlerJobs(repo, SimpleNamespace())

    with pytest.raises(ValueError, match="non-public"):
        await crawler.enqueue_search_discovery("https://internal.example/notices/123")

    assert repo.claims == []
