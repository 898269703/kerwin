from types import SimpleNamespace

import pytest

import app.jobs as jobs_module
from app.jobs import CrawlerJobs, JobRunner


class FakeRepo:
    def __init__(self):
        self.patches = []
        self.pages = []
        self.recovery_calls = 0

    async def fail_interrupted_jobs(self):
        self.recovery_calls += 1

    async def update_crawl_job(self, job_id, **patch):
        self.patches.append((job_id, patch))

    async def record_crawl_page(self, **page):
        self.pages.append(page)


class SchedulerRepo(FakeRepo):
    def __init__(self):
        super().__init__()
        self.created = []

    async def list_due_seed_sites(self, limit=10):
        return [{
            "id": "seed-due",
            "name": "Due",
            "baseUrl": "https://example.com/docs/",
            "allowedHosts": ["example.com"],
            "includePatterns": [],
            "excludePatterns": [],
            "maxDepth": 2,
            "maxRequestsPerMinute": 30,
            "maxConcurrency": 1,
            "maxPdfBytes": 10_000_000,
            "crawlIntervalMinutes": 60,
            "enabled": True,
        }]

    async def create_crawl_job_if_idle(self, seed_site_id, trigger_type, start_url):
        self.created.append((seed_site_id, trigger_type, start_url))
        return {
            "id": "scheduled-job-1",
            "seedSiteId": seed_site_id,
            "triggerType": trigger_type,
            "startUrl": start_url,
            "status": "queued",
        }


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
async def test_worker_start_recovers_interrupted_jobs_before_accepting_work():
    repo = FakeRepo()
    crawler = CrawlerJobs(repo, SimpleNamespace(scheduler_enabled=False))

    await crawler.start()
    await crawler.stop()

    assert repo.recovery_calls == 1


@pytest.mark.asyncio
async def test_scheduler_enqueues_due_seed_without_duplicate_active_job():
    repo = SchedulerRepo()
    crawler = CrawlerJobs(repo, SimpleNamespace(scheduler_enabled=True, scheduler_poll_seconds=60))

    count = await crawler._schedule_due_seeds_once()

    assert count == 1
    assert repo.created == [("seed-due", "seed", "https://example.com/docs/")]
    assert crawler.queue.qsize() == 1
    queued = await crawler.queue.get()
    assert queued.job_id == "scheduled-job-1"
    assert queued.mode == "seed"
    crawler.queue.task_done()


@pytest.mark.asyncio
async def test_scheduler_skips_seed_when_atomic_claim_returns_none():
    repo = SchedulerRepo()

    async def already_active(*_args):
        return None

    repo.create_crawl_job_if_idle = already_active
    crawler = CrawlerJobs(repo, SimpleNamespace(scheduler_enabled=True, scheduler_poll_seconds=60))

    count = await crawler._schedule_due_seeds_once()

    assert count == 0
    assert crawler.queue.qsize() == 0


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
        scheduler_enabled=False,
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
