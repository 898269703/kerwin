from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit


def is_private_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return bool(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def _host_allowed(hostname: str, allowed_hosts: set[str]) -> bool:
    host = hostname.rstrip(".").lower()
    return any(host == allowed or host.endswith("." + allowed) for allowed in {h.rstrip('.').lower() for h in allowed_hosts})


def validate_allowed_url(url: str, allowed_hosts: set[str], *, resolved_ips: list[str]) -> object:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("only HTTP(S) URLs are allowed")
    if parsed.username or parsed.password:
        raise ValueError("URL credentials are not allowed")
    if not parsed.hostname:
        raise ValueError("URL hostname is required")
    if not _host_allowed(parsed.hostname, allowed_hosts):
        raise ValueError("URL host is not allowed")
    if not resolved_ips:
        raise ValueError("hostname did not resolve")
    for value in resolved_ips:
        address = ipaddress.ip_address(value)
        if is_private_address(address):
            raise ValueError("URL resolves to a non-public address")
    return parsed


async def resolve_public_url(url: str, allowed_hosts: set[str]) -> object:
    parsed = urlsplit(url)
    if not parsed.hostname:
        raise ValueError("URL hostname is required")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    def _resolve() -> list[str]:
        rows = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        return sorted({row[4][0] for row in rows})

    ips = await asyncio.to_thread(_resolve)
    return validate_allowed_url(url, allowed_hosts, resolved_ips=ips)
