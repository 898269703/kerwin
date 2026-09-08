from types import SimpleNamespace

import pytest

from app.spider import (
    PdfDiscoverySpider,
    classify_link,
    is_url_within_seed_scope,
    should_accept_pdf_candidate,
    should_follow,
)


def test_pdf_links_are_candidates():
    kind = classify_link("https://www.w3.org/TR/REC-html40/html40.pdf", "HTML 4.0 PDF")
    assert kind == "pdf"


def test_extensionless_chinese_attachment_link_is_pdf_candidate():
    kind = classify_link("https://example.com/api/get?id=123", "附件下载")
    assert kind == "pdf"


def test_direct_external_pdf_can_be_downloaded_but_not_recursively_followed():
    external_pdf = "https://cdn.example.net/files/policy.pdf"
    assert should_accept_pdf_candidate(external_pdf, "政策附件")
    assert not should_follow(
        external_pdf,
        allowed_hosts={"www.example.com"},
        depth=1,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[],
    )


def test_html_links_are_followed_within_depth():
    assert should_follow(
        "https://www.w3.org/TR/REC-html40/",
        allowed_hosts={"www.w3.org"},
        depth=1,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[],
    )


def test_non_html_assets_are_not_recursively_followed():
    for suffix in (".dtd", ".ent", ".cat", ".txt", ".zip", ".tgz", ".ps", ".css", ".js", ".xml"):
        assert not should_follow(
            f"https://www.w3.org/TR/REC-html40-971218/resource{suffix}",
            allowed_hosts={"www.w3.org"},
            depth=1,
            max_depth=4,
            include_patterns=[],
            exclude_patterns=[],
            scope_url="https://www.w3.org/TR/REC-html40-971218/",
        )


def test_external_or_too_deep_links_are_not_followed():
    assert not should_follow(
        "https://example.com/page",
        allowed_hosts={"www.w3.org"},
        depth=1,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[],
    )
    assert not should_follow(
        "https://www.w3.org/deep/page",
        allowed_hosts={"www.w3.org"},
        depth=5,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[],
    )


def test_exclude_patterns_win():
    assert not should_follow(
        "https://www.w3.org/private/page",
        allowed_hosts={"www.w3.org"},
        depth=1,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[r"/private/"],
    )


def test_default_seed_scope_does_not_expand_to_whole_host():
    seed = "https://www.w3.org/TR/REC-html40-971218/"
    assert is_url_within_seed_scope(
        "https://www.w3.org/TR/REC-html40-971218/struct/global.html", seed
    )
    assert not is_url_within_seed_scope("https://www.w3.org/TR/", seed)
    assert not should_follow(
        "https://www.w3.org/TR/",
        allowed_hosts={"www.w3.org"},
        depth=1,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[],
        scope_url=seed,
    )


def test_root_seed_scope_can_cover_whole_host():
    assert is_url_within_seed_scope("https://example.com/news/page", "https://example.com/")


def test_spider_hard_caps_global_and_per_domain_concurrency():
    spider = PdfDiscoverySpider(
        start_url="https://www.w3.org/",
        allowed_hosts={"www.w3.org"},
        max_depth=4,
        max_pages=500,
        max_pdfs=100,
        max_concurrency=999,
        max_requests_per_minute=60,
        include_patterns=[],
        exclude_patterns=[],
    )

    assert spider.concurrent_requests == 6
    assert spider.concurrent_requests_per_domain == 2


class _EmptySelector:
    def get(self, default=None):
        return default

    def __iter__(self):
        return iter(())


class _JsShellResponse:
    url = "https://example.com/app/"
    meta = {"depth": 0}
    status = 200
    headers = {}
    request = SimpleNamespace(sid="http")

    def css(self, selector):
        return _EmptySelector()

    def get(self):
        return "<html><body><div id='app'></div><script></script></body></html>"


@pytest.mark.asyncio
async def test_dynamic_fallback_has_a_hard_total_page_cap():
    spider = PdfDiscoverySpider(
        start_url="https://example.com/app/",
        allowed_hosts={"example.com"},
        max_depth=2,
        max_pages=20,
        max_pdfs=10,
        max_concurrency=2,
        max_requests_per_minute=60,
        max_dynamic_pages=1,
        include_patterns=[],
        exclude_patterns=[],
    )

    first = [item async for item in spider._parse_response(_JsShellResponse(), allow_dynamic_retry=True)]
    second = [item async for item in spider._parse_response(_JsShellResponse(), allow_dynamic_retry=True)]

    assert sum(getattr(item, "sid", None) == "dynamic" for item in first) == 1
    assert sum(getattr(item, "sid", None) == "dynamic" for item in second) == 0
