from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.dynamic_policy import make_browser_page_setup, needs_dynamic_fallback
from app.spider import PdfDiscoverySpider


def test_js_shell_without_links_falls_back_to_browser():
    html = '<html><head><script src="/app.js"></script></head><body><div id="app"></div></body></html>'
    assert needs_dynamic_fallback(html=html, html_link_count=0, pdf_candidate_count=0)


def test_static_links_or_pdf_candidates_do_not_open_browser():
    assert not needs_dynamic_fallback(
        html='<html><body><a href="/policy.html">政策</a></body></html>',
        html_link_count=1,
        pdf_candidate_count=0,
    )
    assert not needs_dynamic_fallback(
        html='<html><body><a href="/download?id=1">附件</a></body></html>',
        html_link_count=0,
        pdf_candidate_count=1,
    )


def test_spider_registers_lazy_dynamic_session():
    spider = PdfDiscoverySpider(
        start_url="https://example.com/",
        allowed_hosts={"example.com"},
        max_depth=2,
        max_pages=10,
        max_pdfs=5,
        max_concurrency=1,
        max_requests_per_minute=30,
    )

    calls = []

    class Manager:
        def add(self, sid, session, **kwargs):
            calls.append((sid, session.__class__.__name__, kwargs))

    spider.configure_sessions(Manager())
    assert calls[0][0] == "http"
    assert calls[1][0] == "dynamic"
    assert calls[1][1] == "AsyncDynamicSession"
    assert calls[1][2]["lazy"] is True


@pytest.mark.asyncio
async def test_browser_page_setup_aborts_private_http_requests_and_allows_public_resources():
    async def resolve_ips(host: str, port: int):
        if host == "127.0.0.1":
            return ["127.0.0.1"]
        if host == "cdn.example.com":
            return ["93.184.216.34"]
        raise AssertionError(f"unexpected host: {host}:{port}")

    setup = make_browser_page_setup(resolve_ips=resolve_ips)

    class Page:
        handler = None

        async def route(self, pattern, handler):
            assert pattern == "**/*"
            self.handler = handler

    class Route:
        def __init__(self, url):
            self.request = SimpleNamespace(url=url)
            self.action = None

        async def abort(self):
            self.action = "abort"

        async def continue_(self):
            self.action = "continue"

    page = Page()
    await setup(page)
    assert page.handler is not None

    private = Route("http://127.0.0.1/admin")
    await page.handler(private)
    assert private.action == "abort"

    public = Route("https://cdn.example.com/app.js")
    await page.handler(public)
    assert public.action == "continue"
