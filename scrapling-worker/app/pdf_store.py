from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

import httpx

from .document_number import extract_document_number
from .url_policy import resolve_public_url


@dataclass(frozen=True)
class DownloadedPdf:
    final_url: str
    status_code: int
    content: bytes
    sha256: str
    byte_size: int
    http_filename: str | None


def verify_pdf_bytes(content: bytes) -> None:
    if not content.startswith(b"%PDF-"):
        raise ValueError("response is not a PDF")


def storage_key_for_hash(sha256: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError("invalid sha256")
    return f"pdfs/{sha256[:2]}/{sha256[2:4]}/{sha256}.pdf"


def normalize_url(url: str) -> str:
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path or "/", parsed.query, ""))


def _filename_from_headers(headers: httpx.Headers, final_url: str) -> str | None:
    cd = headers.get("content-disposition", "")
    utf = re.search(r"filename\*=UTF-8''([^;]+)", cd, re.I)
    if utf:
        return unquote(utf.group(1)).strip().strip('"') or None
    plain = re.search(r"filename=\"?([^\";]+)", cd, re.I)
    if plain:
        return plain.group(1).strip() or None
    name = Path(urlsplit(final_url).path).name
    return unquote(name) if name else None


async def download_pdf(*, url: str, allowed_hosts: set[str], max_bytes: int, user_agent: str) -> DownloadedPdf:
    current = url
    async with httpx.AsyncClient(follow_redirects=False, timeout=httpx.Timeout(45.0), trust_env=False) as client:
        for _ in range(6):
            await resolve_public_url(current, allowed_hosts)
            async with client.stream("GET", current, headers={"user-agent": user_agent, "accept": "application/pdf,*/*;q=0.8"}) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("redirect without location")
                    current = urljoin(current, location)
                    continue
                response.raise_for_status()
                declared = response.headers.get("content-length")
                if declared and int(declared) > max_bytes:
                    raise ValueError("PDF exceeds maximum size")
                chunks: list[bytes] = []
                total = 0
                prefix = bytearray()
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError("PDF exceeds maximum size")
                    if len(prefix) < 5:
                        prefix.extend(chunk[: 5 - len(prefix)])
                    chunks.append(chunk)
                content = b"".join(chunks)
                verify_pdf_bytes(content)
                digest = hashlib.sha256(content).hexdigest()
                return DownloadedPdf(
                    final_url=str(response.url),
                    status_code=response.status_code,
                    content=content,
                    sha256=digest,
                    byte_size=len(content),
                    http_filename=_filename_from_headers(response.headers, str(response.url)),
                )
    raise ValueError("too many redirects")


async def persist_pdf(*, repo, downloaded: DownloadedPdf, data_dir: str, referrer_url: str | None,
                      anchor_text: str | None):
    key = storage_key_for_hash(downloaded.sha256)
    absolute = Path(data_dir) / key
    absolute.parent.mkdir(parents=True, exist_ok=True)
    if not absolute.exists():
        temp = absolute.with_suffix(".part")
        temp.write_bytes(downloaded.content)
        os.replace(temp, absolute)

    title = (anchor_text or "").strip() or downloaded.http_filename or Path(urlsplit(downloaded.final_url).path).name or None
    number = extract_document_number(f"{anchor_text or ''} {downloaded.http_filename or ''} {title or ''}")
    upserted = await repo.upsert_document_by_hash(
        sha256=downloaded.sha256,
        storage_key=key,
        byte_size=downloaded.byte_size,
        preferred_title=title,
        preferred_filename=downloaded.http_filename,
        document_number=number,
    )
    document = upserted["document"]
    await repo.upsert_document_blob(document["id"], downloaded.sha256, downloaded.content)
    await repo.upsert_document_source(
        document_id=document["id"],
        source_url=downloaded.final_url,
        normalized_source_url=normalize_url(downloaded.final_url),
        source_host=urlsplit(downloaded.final_url).hostname.lower(),
        referrer_url=referrer_url,
        anchor_text=anchor_text,
        http_filename=downloaded.http_filename,
        last_http_status=downloaded.status_code,
    )
    return {"document": document, "duplicate": bool(upserted["duplicate"] or absolute.exists()), "storageKey": key}
