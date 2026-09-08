from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    api_token: str
    data_dir: str = "/data"
    port: int = 3001
    user_agent: str = "PDF-Finder-Scrapling/1.0 (+public-document-crawler)"
    max_pages_per_job: int = 500
    max_pdfs_per_job: int = 200
    max_pdf_bytes: int = 104_857_600

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
            max_pdfs_per_job=int(os.environ.get("MAX_PDFS_PER_JOB", "200")),
            max_pdf_bytes=int(os.environ.get("MAX_PDF_BYTES", "104857600")),
        )
