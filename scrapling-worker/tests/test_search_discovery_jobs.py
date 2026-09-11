from types import SimpleNamespace

import pytest

import app.jobs as jobs_module
from app.jobs import CrawlerJobs, QueuedJob


class SearchRepo:
    def __init__(self, *, reused=False, status="queued"):
        self.reused = reused
        self.status = status
        self.claims = []
        self.patches = []
        self.pages = []
        self.links = []
        self.link_statuses = []

    async def claim_search_discovery_job(self, *, normalized_url, start_url):
        self.claims.append((normalized_url, start_url))
        return {
            "id": "33333333-3333-3333-3333-333333333333",
            "seedSiteId": None,
            "triggerType": "discovery",
            "startUrl": start_url,
            "status": self.status,
            "pagesFetched": 0,
            "filesDiscovered": 0,
            "filesDownloaded": 0,
            "duplicatesFound": 0,
            "errorsCount": 0,
            "errorSummary": None,
            "reused": self.reused,
        }

    async def update_crawl_job(self, job_id, **patch):
        self.patches.append((job_id, patch))

    async def record_crawl_page(self, **page):
        self.pages.append(page)

    async def upsert_discovered_link(self, **link):
        self.links.append(link)

    async def mark_discovered_status(self, normalized_url, status):
        self.link_statuses.append((normalized_url, status))


def settings():
    return SimpleNamespace(
        max_pdf_bytes=100_000_000,
        user_agent="test-agent",
        data_dir="/tmp/search-discovery-tests",
        max_pages_per_job=500,
        max_pdfs_per_job=100,
        max_dynamic_pages=20,
        max_job_seconds=300,
        scheduler_enabled=False,
    )


async def allow_public_url(url, allowed_hosts):
    return SimpleNamespace(url=url, allowed_hosts=allowed_hosts)


@pytest.mark.asyncio
async def test_enqueue_search_discovery_claims_and_queues_new_job(monkeypatch):
    monkeypatch.setattr(jobs_module, "resolve_public_url", allow_public_url)
    repo = SearchRepo(reused=False)
    crawler = CrawlerJobs(repo, settings())

    job = await crawler.enqueue_search_discovery("https://example.gov/notices/123")

    assert job["reused"] is False
    assert repo.claims == [("https://example.gov/notices/123", "https://example.gov/notices/123")]
    queued = crawler.queue.get_nowait()
    assert queued.mode == "search-discovery"
    assert queued.seed is None
    assert queued.start_url == "https://example.gov/notices/123"


@pytest.mark.asyncio
async def test_enqueue_search_discovery_does_not_requeue_reused_job(monkeypatch):
    monkeypatch.setattr(jobs_module, "resolve_public_url", allow_public_url)
    repo = SearchRepo(reused=True, status="running")
    crawler = CrawlerJobs(repo, settings())

    job = await crawler.enqueue_search_discovery("https://example.gov/notices/123")

    assert job["reused"] is True
    assert crawler.queue.empty()


@pytest.mark.asyncio
async def test_search_discovery_html_uses_exact_ephemeral_limits(monkeypatch):
    captured = {}

    class FakeSpider:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def stream(self):
            yield {
                "kind": "page",
                "url": "https://example.gov/notices/123",
                "statusCode": 200,
                "contentType": "text/html",
                "depth": 0,
                "pageTitle": "Notice",
            }

        def pause(self):
            pass

    monkeypatch.setattr(jobs_module, "PdfDiscoverySpider", FakeSpider)
    repo = SearchRepo()
    crawler = CrawlerJobs(repo, settings())
    item = QueuedJob(
        "job-html",
        "search-discovery",
        None,
        "https://example.gov/notices/123",
    )

    status = await crawler._execute(item)

    assert status == "succeeded"
    assert captured["start_url"] == "https://example.gov/notices/123"
    assert captured["allowed_hosts"] == {"example.gov"}
    assert captured["max_depth"] == 2
    assert captured["max_pages"] == 20
    assert captured["max_pdfs"] == 10
    assert captured["max_concurrency"] == 1
    assert captured["max_dynamic_pages"] == 3
    assert repo.pages[0]["job_id"] == "job-html"
    assert any(patch.get("pages_fetched") == 1 for _, patch in repo.patches)


@pytest.mark.asyncio
async def test_search_discovery_direct_pdf_bypasses_spider(monkeypatch):
    calls = {"download": 0, "persist": 0}

    class ForbiddenSpider:
        def __init__(self, **_kwargs):
            raise AssertionError("direct PDF must not instantiate the spider")

    async def fake_download_pdf(**kwargs):
        calls["download"] += 1
        assert kwargs["url"] == "https://example.gov/files/a.pdf"
        assert kwargs["allowed_hosts"] == {"example.gov"}
        return SimpleNamespace(final_url=kwargs["url"])

    async def fake_persist_pdf(**kwargs):
        calls["persist"] += 1
        assert kwargs["referrer_url"] is None
        return {"duplicate": False}

    monkeypatch.setattr(jobs_module, "PdfDiscoverySpider", ForbiddenSpider)
    monkeypatch.setattr(jobs_module, "download_pdf", fake_download_pdf)
    monkeypatch.setattr(jobs_module, "persist_pdf", fake_persist_pdf)

    repo = SearchRepo()
    crawler = CrawlerJobs(repo, settings())
    item = QueuedJob(
        "job-pdf",
        "search-discovery",
        None,
        "https://example.gov/files/a.pdf",
    )

    status = await crawler._execute(item)

    assert status == "succeeded"
    assert calls == {"download": 1, "persist": 1}
    assert repo.links[0]["likely_document"] is True
    assert repo.link_statuses[-1][1] == "downloaded"
    assert any(patch.get("files_downloaded") == 1 for _, patch in repo.patches)
