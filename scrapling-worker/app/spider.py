from __future__ import annotations

from urllib.parse import urljoin

from scrapling.fetchers import AsyncDynamicSession, FetcherSession
from scrapling.spiders import Request, Response, Spider

from .dynamic_policy import make_browser_page_setup, needs_dynamic_fallback
from .link_policy import (
    classify_link,
    is_url_within_seed_scope,
    should_accept_pdf_candidate,
    should_follow,
)


class PdfDiscoverySpider(Spider):
    name = "pdf_discovery"
    robots_txt_obey = True
    autothrottle_enabled = True
    autothrottle_start_delay = 0.5
    autothrottle_max_delay = 15.0
    max_blocked_retries = 1

    def __init__(self, *, start_url: str, allowed_hosts: set[str], max_depth: int,
                 max_pages: int, max_pdfs: int, max_concurrency: int,
                 max_requests_per_minute: int, max_dynamic_pages: int = 20,
                 include_patterns: list[str] | None = None,
                 exclude_patterns: list[str] | None = None):
        super().__init__()
        self.start_url = start_url
        self.start_urls = [start_url]
        self.allowed_hosts_cfg = {h.lower() for h in allowed_hosts}
        self.allowed_domains = set(self.allowed_hosts_cfg)
        self.max_depth_cfg = max_depth
        self.max_pages_cfg = max(1, max_pages)
        self.max_pdfs_cfg = max(1, max_pdfs)
        self.max_dynamic_pages_cfg = max(0, min(20, max_dynamic_pages))
        self.include_patterns_cfg = include_patterns or []
        self.exclude_patterns_cfg = exclude_patterns or []
        self.concurrent_requests = min(6, max(1, max_concurrency))
        self.concurrent_requests_per_domain = min(2, self.concurrent_requests)
        self.download_delay = max(0.0, 60.0 / max(1, max_requests_per_minute))
        self._page_count = 0
        self._pdf_count = 0
        self._dynamic_page_count = 0
        self._browser_page_setup = make_browser_page_setup()

    def configure_sessions(self, manager):
        manager.add("http", FetcherSession(follow_redirects="safe"), default=True)
        manager.add(
            "dynamic",
            AsyncDynamicSession(headless=True, network_idle=True, timeout=30000, max_pages=1),
            lazy=True,
        )

    async def start_requests(self):
        yield Request(self.start_url, sid="http", callback=self.parse, meta={"depth": 0})

    async def parse(self, response: Response):
        async for item in self._parse_response(response, allow_dynamic_retry=True):
            yield item

    async def parse_dynamic(self, response: Response):
        async for item in self._parse_response(response, allow_dynamic_retry=False):
            yield item

    async def _parse_response(self, response: Response, *, allow_dynamic_retry: bool):
        depth = int(response.meta.get("depth", 0))
        self._page_count += 1
        title = response.css("title::text").get("")
        fetch_mode = getattr(getattr(response, "request", None), "sid", "") or "http"
        yield {
            "kind": "page",
            "url": str(response.url),
            "statusCode": int(response.status),
            "contentType": response.headers.get("content-type", "") if response.headers else "",
            "depth": depth,
            "pageTitle": title.strip() if title else None,
            "fetchMode": fetch_mode,
        }

        if self._page_count >= self.max_pages_cfg:
            # Stop already queued work too; returning from this callback alone would
            # not prevent the scheduler from draining requests queued by earlier pages.
            try:
                self.pause()
            except RuntimeError:
                pass
            return

        # If no explicit include regexes were supplied, a redirect must not silently
        # widen a directory seed into a whole-host crawl. We still record the page so
        # operators can see the redirect target, but we do not extract from it.
        if self.include_patterns_cfg == [] and not is_url_within_seed_scope(str(response.url), self.start_url):
            return

        html_link_count = 0
        pdf_candidate_count = 0

        for anchor in response.css("a[href]"):
            href = anchor.css("::attr(href)").get()
            if not href:
                continue
            absolute = urljoin(str(response.url), href)
            text = anchor.get_all_text(strip=True) if hasattr(anchor, "get_all_text") else ""

            # A directly discovered file candidate is allowed to live on a CDN or
            # attachment host outside the seed site's recursive HTML allowlist.
            # The downloader revalidates its exact candidate host, redirects,
            # DNS/IP safety, size and PDF bytes before persistence.
            if should_accept_pdf_candidate(absolute, text):
                if self._pdf_count >= self.max_pdfs_cfg:
                    continue
                self._pdf_count += 1
                pdf_candidate_count += 1
                yield {
                    "kind": "pdf",
                    "url": absolute,
                    "referrerUrl": str(response.url),
                    "anchorText": text or None,
                    "depth": depth,
                }
                continue

            next_depth = depth + 1
            if should_follow(
                absolute,
                allowed_hosts=self.allowed_hosts_cfg,
                depth=next_depth,
                max_depth=self.max_depth_cfg,
                include_patterns=self.include_patterns_cfg,
                exclude_patterns=self.exclude_patterns_cfg,
                scope_url=self.start_url,
            ):
                html_link_count += 1
                yield Request(
                    absolute,
                    sid="http",
                    callback=self.parse,
                    meta={"depth": next_depth},
                )

        if (
            allow_dynamic_retry
            and self._dynamic_page_count < self.max_dynamic_pages_cfg
            and needs_dynamic_fallback(
                html=str(response.get()),
                html_link_count=html_link_count,
                pdf_candidate_count=pdf_candidate_count,
            )
        ):
            self._dynamic_page_count += 1
            # Session ID participates in Scrapling's request fingerprint, so the same URL
            # can safely be revisited through the browser after the static HTTP request.
            yield Request(
                str(response.url),
                sid="dynamic",
                callback=self.parse_dynamic,
                meta={"depth": depth},
                priority=1,
                page_setup=self._browser_page_setup,
                google_search=False,
                network_idle=True,
                timeout=30000,
            )
