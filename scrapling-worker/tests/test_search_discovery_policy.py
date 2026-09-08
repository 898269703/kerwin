import pytest

from app.search_discovery import build_search_candidate


def test_directory_candidate_keeps_subtree_scope_and_hard_limits():
    candidate = build_search_candidate("https://example.gov/notices/2026/")

    assert candidate.url == "https://example.gov/notices/2026/"
    assert candidate.normalized_url == "https://example.gov/notices/2026/"
    assert candidate.host == "example.gov"
    assert candidate.scope_url == "https://example.gov/notices/2026/"
    assert candidate.allowed_hosts == {"example.gov"}
    assert candidate.max_depth == 2
    assert candidate.max_pages == 20
    assert candidate.max_pdfs == 10
    assert candidate.max_job_seconds == 120
    assert candidate.max_concurrency == 1
    assert candidate.max_dynamic_pages == 3
    assert candidate.is_direct_pdf_hint is False


def test_file_candidate_uses_parent_directory_as_scope_anchor():
    candidate = build_search_candidate("https://example.gov/notices/2026/detail.html?from=search#section")

    assert candidate.scope_url == "https://example.gov/notices/2026/"
    assert candidate.normalized_url == "https://example.gov/notices/2026/detail.html?from=search"


def test_extensionless_candidate_does_not_expand_to_site_root():
    candidate = build_search_candidate("https://example.gov/notices/12345")

    assert candidate.scope_url == "https://example.gov/notices/12345"


@pytest.mark.parametrize(
    "url",
    [
        "https://example.gov/files/a.pdf",
        "https://example.gov/download?id=123",
        "https://example.gov/attachment/123",
    ],
)
def test_direct_pdf_hints_are_classified_without_relaxing_limits(url):
    candidate = build_search_candidate(url)

    assert candidate.is_direct_pdf_hint is True
    assert candidate.max_pages == 20
    assert candidate.max_pdfs == 10


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.gov/file.pdf",
        "https://user:pass@example.gov/a.pdf",
        "http://localhost/a.pdf",
        "http://localhost.localdomain/a.pdf",
        "http://127.0.0.1/a.pdf",
        "http://10.0.0.8/a.pdf",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/a.pdf",
    ],
)
def test_unsafe_candidate_rejected_before_queueing(url):
    with pytest.raises(ValueError):
        build_search_candidate(url)
