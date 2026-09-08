from types import SimpleNamespace

import pytest

import app.jobs as jobs_module
from app.jobs import CrawlerJobs, JobRunner


class FakeRepo:
    def __init__(self):
        self.patches = []
        self.pages = []

    async def update_crawl_job(self, job_id, **patch):
        self.patches.append((job_id, patch))

    async def record_crawl_page(self, **page):
        self.pages.append(page)


@pytest.mark.asyncio
async def test_job_runner_marks_success_and_isolates_failures():
    repo = FakeRepo()
    calls = []

    async def run(job_id):
        calls.append(job_id)
        if job_id == "bad":
            raise RuntimeError("boom")

    runner = JobRunner(repo, run)
    await runner.run_one("good")
    await runner.run_one("bad")

    assert calls == ["good", "bad"]
    assert any(patch.get("status") == "succeeded" for _, patch in repo.patches)
    assert any(patch.get("status") == "failed" and "boom" in patch.get("error_summary", "") for _, patch in repo.patches)


@pytest.mark.asyncio
async def test_seed_crawl_persists_progress_while_streaming(monkeypatch):
    class FakeSpider:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def stream(self):
            yield {
                "kind": "page",
                "url": "https://example.com/docs/",
                "statusCode": 200,
                "contentType": "text/html",
                "depth": 0,
                "pageTitle": "Docs",
            }
            yield {
                "kind": "page",
                "url": "https://example.com/docs/next",
                "statusCode": 200,
                "contentType": "text/html",
                "depth": 1,
                "pageTitle": "Next",
            }

        def start(self):
            return SimpleNamespace(items=[])

    monkeypatch.setattr(jobs_module, "PdfDiscoverySpider", FakeSpider)
    repo = FakeRepo()
    settings = SimpleNamespace(
        max_pages_per_job=20,
        max_pdfs_per_job=10,
        max_dynamic_pages=2,
        max_pdf_bytes=10_000_000,
        max_job_seconds=60,
        user_agent="test",
        data_dir="/tmp",
    )
    crawler = CrawlerJobs(repo, settings)
    item = SimpleNamespace(
        job_id="job-1",
        seed={
            "allowedHosts": ["example.com"],
            "maxDepth": 2,
            "maxConcurrency": 2,
            "maxRequestsPerMinute": 60,
            "maxPdfBytes": 10_000_000,
            "includePatterns": [],
            "excludePatterns": [],
        },
        start_url="https://example.com/docs/",
    )

    status = await crawler._run_seed(item)

    assert status == "succeeded"
    assert len(repo.pages) == 2
    assert any(patch.get("pages_fetched") == 1 for _, patch in repo.patches)
    assert repo.patches[-1][1].get("pages_fetched") == 2
