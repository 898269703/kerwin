from __future__ import annotations

import os
from dataclasses import dataclass


def _bounded_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    value = int(os.environ.get(name, str(default)))
    return max(minimum, min(maximum, value))


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


@dataclass(frozen=True)
class Settings:
    database_url: str
    api_token: str
    data_dir: str = "/data"
    port: int = 3001
    user_agent: str = "PDF-Finder-Scrapling/1.0 (+public-document-crawler)"
    max_pages_per_job: int = 500
    max_pdfs_per_job: int = 100
    max_pdf_bytes: int = 104_857_600
    max_dynamic_pages: int = 20
    max_job_seconds: int = 300
    global_concurrency: int = 6
    per_domain_concurrency: int = 2
    scheduler_enabled: bool = True
    scheduler_poll_seconds: int = 60

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = os.environ.get("DATABASE_URL", "").strip()
        api_token = os.environ.get("CRAWLER_API_TOKEN", "").strip()
        if not database_url:
            raise RuntimeError("DATABASE_URL is required")
        if not api_token:
            raise RuntimeError("CRAWLER_API_TOKEN is required")
        return cls(
            database_url=database_url,
            api_token=api_token,
            data_dir=os.environ.get("DATA_DIR", "/data"),
            port=int(os.environ.get("PORT", "3001")),
            user_agent=os.environ.get("USER_AGENT", "PDF-Finder-Scrapling/1.0 (+public-document-crawler)"),
            max_pages_per_job=int(os.environ.get("MAX_PAGES_PER_JOB", "500")),
            max_pdfs_per_job=_bounded_int("MAX_PDFS_PER_JOB", 100, minimum=1, maximum=100),
            max_pdf_bytes=int(os.environ.get("MAX_PDF_BYTES", "104857600")),
            max_dynamic_pages=_bounded_int("MAX_DYNAMIC_PAGES", 20, minimum=0, maximum=20),
            max_job_seconds=_bounded_int("MAX_JOB_SECONDS", 300, minimum=30, maximum=1800),
            global_concurrency=_bounded_int("GLOBAL_CONCURRENCY", 6, minimum=1, maximum=6),
            per_domain_concurrency=_bounded_int("PER_DOMAIN_CONCURRENCY", 2, minimum=1, maximum=2),
            scheduler_enabled=_bool_env("SCHEDULER_ENABLED", True),
            scheduler_poll_seconds=_bounded_int("SCHEDULER_POLL_SECONDS", 60, minimum=30, maximum=3600),
        )
