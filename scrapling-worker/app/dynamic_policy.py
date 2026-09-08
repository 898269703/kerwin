from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit


_JS_SHELL = re.compile(
    r"(?:<script\b|id=[\"'](?:app|root|__next|app-root)[\"']|<noscript\b)",
    re.IGNORECASE,
)

ResolveIps = Callable[[str, int], Awaitable[list[str]]]


def needs_dynamic_fallback(*, html: str, html_link_count: int, pdf_candidate_count: int) -> bool:
    """Use a browser only for a JS-looking shell that yielded no useful static targets."""
    if html_link_count > 0 or pdf_candidate_count > 0:
        return False
    return bool(_JS_SHELL.search(html or ""))


def _is_non_public_ip(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return bool(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def validate_browser_request_url(url: str, *, resolved_ips: list[str]) -> None:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("only HTTP(S) browser requests are validated")
    if parsed.username or parsed.password:
        raise ValueError("URL credentials are not allowed")
    if not parsed.hostname:
        raise ValueError("URL hostname is required")
    if not resolved_ips:
        raise ValueError("hostname did not resolve")
    if any(_is_non_public_ip(value) for value in resolved_ips):
        raise ValueError("browser request resolves to a non-public address")


async def _resolve_ips(host: str, port: int) -> list[str]:
    def resolve() -> list[str]:
        rows = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        return sorted({row[4][0] for row in rows})

    return await asyncio.to_thread(resolve)


def make_browser_page_setup(*, resolve_ips: ResolveIps = _resolve_ips):
    """Register a pre-navigation Playwright route guard for all HTTP(S) requests.

    The guard allows public third-party CDNs needed to render a page, but aborts
    requests that resolve to loopback/private/link-local/reserved addresses.
    """
    dns_cache: dict[tuple[str, int], list[str]] = {}

    async def page_setup(page) -> None:
        async def guard(route) -> None:
            request_url = route.request.url
            parsed = urlsplit(request_url)
            if parsed.scheme not in {"http", "https"}:
                await route.continue_()
                return

            try:
                if not parsed.hostname:
                    raise ValueError("URL hostname is required")
                port = parsed.port or (443 if parsed.scheme == "https" else 80)
                key = (parsed.hostname.lower(), port)
                if key not in dns_cache:
                    dns_cache[key] = await resolve_ips(key[0], key[1])
                validate_browser_request_url(request_url, resolved_ips=dns_cache[key])
            except (OSError, ValueError):
                await route.abort()
                return

            await route.continue_()

        await page.route("**/*", guard)

    return page_setup
