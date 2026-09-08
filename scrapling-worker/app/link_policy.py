from __future__ import annotations

import re
from urllib.parse import urlsplit


_LIKELY_PDF_PATH = re.compile(
    r"(?:\.pdf(?:$|[?#])|/(?:download|attachment|attachments|file|files)(?:/|\?|$))",
    re.IGNORECASE,
)
_ATTACHMENT_TEXT = re.compile(r"(?:pdf|附件|下载|文件)", re.IGNORECASE)
_NON_HTML_PATH = re.compile(
    r"\.(?:dtd|ent|cat|txt|zip|tgz|tar|gz|ps|css|js|xml|json|rss|atom|"
    r"jpe?g|png|gif|svg|webp|ico|mp3|mp4|webm|woff2?|ttf|eot)(?:$|[?#])",
    re.IGNORECASE,
)


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


def _seed_scope_path(seed_url: str) -> tuple[str, str]:
    parsed = urlsplit(seed_url)
    path = parsed.path or "/"
    if path == "/":
        return "root", "/"
    if path.endswith("/"):
        return "prefix", path
    last_segment = path.rsplit("/", 1)[-1]
    if "." in last_segment:
        parent = path.rsplit("/", 1)[0] + "/"
        return "prefix", parent
    return "subtree", path.rstrip("/")


def is_url_within_seed_scope(url: str, seed_url: str) -> bool:
    """Keep recursive HTML traversal inside the seed's natural URL subtree.

    A root seed (``https://example.com/``) intentionally covers the full host.
    Directory seeds cover descendants. Extension-looking document/article seeds
    cover their parent directory, while extensionless paths cover their subtree.
    Host permission remains a separate check in ``should_follow``.
    """
    parsed = urlsplit(url)
    seed = urlsplit(seed_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or not seed.hostname:
        return False
    if parsed.hostname.lower().rstrip(".") != seed.hostname.lower().rstrip("."):
        return False

    mode, scope = _seed_scope_path(seed_url)
    path = parsed.path or "/"
    if mode == "root":
        return True
    if mode == "prefix":
        return path.startswith(scope)
    return path == scope or path.startswith(scope + "/")


def should_follow(
    url: str,
    *,
    allowed_hosts: set[str],
    depth: int,
    max_depth: int,
    include_patterns: list[str],
    exclude_patterns: list[str],
    scope_url: str | None = None,
) -> bool:
    if depth > max_depth:
        return False
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    if not _host_allowed(parsed.hostname, allowed_hosts):
        return False
    if scope_url and not include_patterns and not is_url_within_seed_scope(url, scope_url):
        return False
    if any(re.search(pattern, url) for pattern in exclude_patterns):
        return False
    if include_patterns and not any(re.search(pattern, url) for pattern in include_patterns):
        return False
    if _NON_HTML_PATH.search(parsed.path):
        return False
    return classify_link(url) == "html"
