from __future__ import annotations

import re
from urllib.parse import urlsplit


_LIKELY_PDF_PATH = re.compile(
    r"(?:\.pdf(?:$|[?#])|/(?:download|attachment|attachments|file|files)(?:/|\?|$))",
    re.IGNORECASE,
)
_ATTACHMENT_TEXT = re.compile(r"(?:pdf|附件|下载|文件)", re.IGNORECASE)


def classify_link(url: str, anchor_text: str | None = None) -> str:
    text = anchor_text or ""
    if _LIKELY_PDF_PATH.search(url) or _ATTACHMENT_TEXT.search(text):
        return "pdf"
    return "html"


def should_accept_pdf_candidate(url: str, anchor_text: str | None = None) -> bool:
    parsed = urlsplit(url)
    return bool(
        parsed.scheme in {"http", "https"}
        and parsed.hostname
        and classify_link(url, anchor_text) == "pdf"
    )


def candidate_download_hosts(url: str, seed_allowed_hosts: set[str]) -> set[str]:
    """Allow the seed hosts plus the directly discovered candidate host.

    This is only used for a file candidate discovered on an already allowed page.
    The downloader still resolves and validates every redirect target against this
    finite host set and blocks non-public IP addresses.
    """
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("valid HTTP(S) candidate URL required")
    return {host.lower().rstrip(".") for host in seed_allowed_hosts} | {parsed.hostname.lower().rstrip(".")}


def _host_allowed(host: str, allowed_hosts: set[str]) -> bool:
    host = host.lower().rstrip(".")
    return any(
        host == allowed.lower().rstrip(".")
        or host.endswith("." + allowed.lower().rstrip("."))
        for allowed in allowed_hosts
    )


def should_follow(
    url: str,
    *,
    allowed_hosts: set[str],
    depth: int,
    max_depth: int,
    include_patterns: list[str],
    exclude_patterns: list[str],
) -> bool:
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
