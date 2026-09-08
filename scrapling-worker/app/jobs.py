from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable
from urllib.parse import urlsplit

from .link_policy import candidate_download_hosts
from .pdf_store import download_pdf, normalize_url, persist_pdf
from .spider import PdfDiscoverySpider


class JobRunner:
    def __init__(self, repo, run_job: Callable[[str], Awaitable[str | None]]):
        self.repo = repo
        self.run_job = run_job

    async def run_one(self, job_id: str):
        await self.repo.update_crawl_job(job_id, status="running", started=True)
        try:
            status = await self.run_job(job_id) or "succeeded"
            await self.repo.update_crawl_job(job_id, status=status, finished=True)
        except Exception as exc:
            await self.repo.update_crawl_job(job_id, status="failed", errors_count=1, error_summary=str(exc)[:2000], finished=True)


@dataclass
class QueuedJob:
    job_id: str
    mode: str
    seed: dict
    start_url: str
    referrer_url: str | None = None


class CrawlerJobs:
    def __init__(self, repo, settings):
        self.repo = repo
        self.settings = settings
        self.queue: asyncio.Queue[QueuedJob | None] = asyncio.Queue()
        self.task: asyncio.Task | None = None

    async def start(self):
        if not self.task:
            self.task = asyncio.create_task(self._worker(), name="scrapling-crawl-worker")

    async def stop(self):
        if self.task:
            await self.queue.put(None)
            await self.task
            self.task = None

    async def enqueue_seed(self, seed_site_id: str, start_url: str | None = None):
        seed = await self.repo.get_seed_site(seed_site_id)
        if not seed or not seed["enabled"]:
            raise LookupError("enabled seed site not found")
        url = start_url or seed["baseUrl"]
        job = await self.repo.create_crawl_job(seed["id"], "seed", url)
        await self.queue.put(QueuedJob(job["id"], "seed", seed, url))
        return job

    async def enqueue_ingest(self, url: str, referrer_url: str | None = None):
        host = (urlsplit(url).hostname or "").lower()
        seed = await self.repo.find_seed_for_host(host)
        if not seed or not seed["enabled"]:
            raise LookupError("url host is not covered by an enabled seed site")
        job = await self.repo.create_crawl_job(seed["id"], "discovery", url)
        await self.queue.put(QueuedJob(job["id"], "ingest", seed, url, referrer_url))
        return job

    async def _worker(self):
        while True:
            item = await self.queue.get()
            if item is None:
                self.queue.task_done()
                return
            runner = JobRunner(self.repo, lambda job_id: self._execute(item))
            await runner.run_one(item.job_id)
            self.queue.task_done()

    async def _execute(self, item: QueuedJob) -> str:
        if item.mode == "ingest":
            return await self._run_ingest(item)
        return await self._run_seed(item)

    async def _run_ingest(self, item: QueuedJob) -> str:
        seed = item.seed
        normalized = normalize_url(item.start_url)
        host = (urlsplit(item.start_url).hostname or "").lower()
        await self.repo.upsert_discovered_link(
            url=item.start_url, normalized_url=normalized, referrer_url=item.referrer_url,
            source_host=host, anchor_text=None, likely_document=True, ingestion_status="queued",
        )
        try:
            downloaded = await download_pdf(
                url=item.start_url,
                allowed_hosts=set(seed["allowedHosts"]),
                max_bytes=min(seed["maxPdfBytes"], self.settings.max_pdf_bytes),
                user_agent=self.settings.user_agent,
            )
            result = await persist_pdf(repo=self.repo, downloaded=downloaded, data_dir=self.settings.data_dir,
                                       referrer_url=item.referrer_url, anchor_text=None)
            await self.repo.mark_discovered_status(normalized, "downloaded")
            await self.repo.update_crawl_job(
                item.job_id, files_discovered=1, files_downloaded=1,
                duplicates_found=1 if result["duplicate"] else 0,
            )
            return "succeeded"
        except Exception:
            await self.repo.mark_discovered_status(normalized, "failed")
            raise

    async def _run_seed(self, item: QueuedJob) -> str:
        seed = item.seed
        spider = PdfDiscoverySpider(
            start_url=item.start_url,
            allowed_hosts=set(seed["allowedHosts"]),
            max_depth=seed["maxDepth"],
            max_pages=self.settings.max_pages_per_job,
            max_pdfs=self.settings.max_pdfs_per_job,
            max_concurrency=seed["maxConcurrency"],
            max_requests_per_minute=seed["maxRequestsPerMinute"],
            include_patterns=seed["includePatterns"],
            exclude_patterns=seed["excludePatterns"],
        )
        result = await asyncio.to_thread(spider.start)
        pages = discovered = downloaded_count = duplicates = errors = 0
        error_messages: list[str] = []

        for crawl_item in result.items:
            if crawl_item.get("kind") == "page":
                pages += 1
                await self.repo.record_crawl_page(
                    job_id=item.job_id, url=crawl_item["url"], normalized_url=normalize_url(crawl_item["url"]),
                    status_code=crawl_item.get("statusCode"), content_type=crawl_item.get("contentType"),
                    depth=int(crawl_item.get("depth", 0)), page_title=crawl_item.get("pageTitle"), error=None,
                )
                continue
            if crawl_item.get("kind") != "pdf":
                continue
            discovered += 1
            url = crawl_item["url"]
            normalized = normalize_url(url)
            host = (urlsplit(url).hostname or "").lower()
            await self.repo.upsert_discovered_link(
                url=url, normalized_url=normalized, referrer_url=crawl_item.get("referrerUrl"),
                source_host=host, anchor_text=crawl_item.get("anchorText"), likely_document=True,
                ingestion_status="queued",
            )
            try:
                # The candidate was discovered on an already allowed HTML page. Permit
                # its exact host for this file download only; recursive crawling remains
                # limited to the seed site's allowed hosts. download_pdf still performs
                # DNS/private-network validation and revalidates every redirect.
                download_hosts = candidate_download_hosts(url, set(seed["allowedHosts"]))
                pdf = await download_pdf(
                    url=url, allowed_hosts=download_hosts,
                    max_bytes=min(seed["maxPdfBytes"], self.settings.max_pdf_bytes), user_agent=self.settings.user_agent,
                )
                stored = await persist_pdf(repo=self.repo, downloaded=pdf, data_dir=self.settings.data_dir,
                                           referrer_url=crawl_item.get("referrerUrl"), anchor_text=crawl_item.get("anchorText"))
                await self.repo.mark_discovered_status(normalized, "downloaded")
                downloaded_count += 1
                if stored["duplicate"]:
                    duplicates += 1
            except Exception as exc:
                errors += 1
                error_messages.append(f"{url}: {exc}")
                await self.repo.mark_discovered_status(normalized, "failed")

        await self.repo.update_crawl_job(
            item.job_id, pages_fetched=pages, files_discovered=discovered,
            files_downloaded=downloaded_count, duplicates_found=duplicates, errors_count=errors,
            error_summary="\n".join(error_messages)[:2000] if error_messages else None,
        )
        return "partial" if errors else "succeeded"
