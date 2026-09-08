from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from .pdf_store import normalize_url
from .url_policy import validate_public_candidate_host


_PAGE_FILE_SUFFIXES = (".html", ".htm", ".shtml", ".asp", ".aspx", ".jsp", ".php")


@dataclass(frozen=True)
class SearchCandidate:
    url: str
    normalized_url: str
    host: str
    start_url: str
    scope_url: str
    allowed_hosts: set[str]
    max_depth: int = 2
    max_pages: int = 20
    max_pdfs: int = 10
    max_job_seconds: int = 120
    max_concurrency: int = 1
    max_dynamic_pages: int = 3
    is_direct_pdf_hint: bool = False


def build_search_candidate(url: str) -> SearchCandidate:
    value = url.strip()
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("only public HTTP(S) candidate URLs are allowed")
    if parsed.username or parsed.password:
        raise ValueError("URL credentials are not allowed")

    host = validate_public_candidate_host(parsed.hostname)
    path = parsed.path or "/"
    lower_path = path.lower()

    if path.endswith("/"):
        scope_path = path
    elif lower_path.endswith(_PAGE_FILE_SUFFIXES):
        parent = path.rsplit("/", 1)[0]
        scope_path = (parent or "") + "/"
    else:
        scope_path = path

    scope_url = urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), scope_path, "", ""))
    direct = (
        lower_path.endswith(".pdf")
        or "/download" in lower_path
        or "/attachment" in lower_path
    )

    return SearchCandidate(
        url=value,
        normalized_url=normalize_url(value),
        host=host,
        start_url=value,
        scope_url=scope_url,
        allowed_hosts={host},
        is_direct_pdf_hint=direct,
    )
