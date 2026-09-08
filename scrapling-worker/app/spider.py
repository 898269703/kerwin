from __future__ import annotations

import re
from urllib.parse import urljoin, urlsplit

from scrapling.spiders import Request, Response, Spider


_LIKELY_PDF_PATH = re.compile(r"(?:\.pdf(?:$|[?#])|/(?:download|attachment|attachments|file|files)(?:/|\?|$))", re.I)


def classify_link(url: str, anchor_text: str | None = None) -> str:
    text = (anchor_text or "").lower()
    if _LIKELY_PDF_PATH.search(url) or ".pdf" in text or "pdf" in text:
        return "pdf"
    return "html"


def _host_allowed(host: str, allowed_hosts: set[str]) -> bool:
    host = host.lower().rstrip(".")
    return any(host == allowed.lower().rstrip(".") or host.endswith("." + allowed.lower().rstrip(".")) for allowed in allowed_hosts)


def should_follow(url: str, *, allowed_hosts: set[str], depth: int, max_depth: int,
                  include_patterns: list[str], exclude_patterns: list[str]) -> bool:
    if depth > max_depth:
        return False
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    if not _host_allowed(parsed.hostname, allowed_hosts):
        return False
    if any(re.search(pattern, url) for pattern in exclude_patterns):
        return False
    if include_patterns and not any(re.search(pattern, url) for pattern in include_patterns):
        return False
    return classify_link(url) == "html"


class PdfDiscoverySpider(Spider):
    name = "pdf_discovery"
    robots_txt_obey = True
    autothrottle_enabled = True
    autothrottle_start_delay = 0.5
    autothrottle_max_delay = 15.0
    max_blocked_retries = 1

    def __init__(self, *, start_url: str, allowed_hosts: set[str], max_depth: int,
                 max_pages: int, max_pdfs: int, max_concurrency: int,
                 max_requests_per_minute: int, include_patterns: list[str] | None = None,
                 exclude_patterns: list[str] | None = None):
        super().__init__()
        self.start_url = start_url
        self.start_urls = [start_url]
        self.allowed_hosts_cfg = {h.lower() for h in allowed_hosts}
        self.allowed_domains = set(self.allowed_hosts_cfg)
        self.max_depth_cfg = max_depth
        self.max_pages_cfg = max_pages
        self.max_pdfs_cfg = max_pdfs
        self.include_patterns_cfg = include_patterns or []
        self.exclude_patterns_cfg = exclude_patterns or []
        self.concurrent_requests = max(1, max_concurrency)
        self.concurrent_requests_per_domain = max(1, max_concurrency)
        self.download_delay = max(0.0, 60.0 / max(1, max_requests_per_minute))
        self._page_count = 0
        self._pdf_count = 0

    async def start_requests(self):
        yield Request(self.start_url, callback=self.parse, meta={"depth": 0})

    async def parse(self, response: Response):
        depth = int(response.meta.get("depth", 0))
        self._page_count += 1
        title = response.css("title::text").get("")
        yield {
            "kind": "page",
            "url": str(response.url),
            "statusCode": int(response.status),
            "contentType": response.headers.get("content-type", "") if response.headers else "",
            "depth": depth,
            "pageTitle": title.strip() if title else None,
        }
        if self._page_count >= self.max_pages_cfg:
            return

        for anchor in response.css("a[href]"):
            href = anchor.css("::attr(href)").get()
            if not href:
                continue
            absolute = urljoin(str(response.url), href)
            text = anchor.get_all_text(strip=True) if hasattr(anchor, "get_all_text") else ""
            parsed = urlsplit(absolute)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                continue
            if not _host_allowed(parsed.hostname, self.allowed_hosts_cfg):
                continue

            if classify_link(absolute, text) == "pdf":
                if self._pdf_count >= self.max_pdfs_cfg:
                    continue
                self._pdf_count += 1
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
            ):
                yield response.follow(absolute, callback=self.parse, meta={"depth": next_depth})
