from __future__ import annotations

import json
import re
import unicodedata
from typing import Any


class Repository:
    def __init__(self, db):
        self.db = db

    @staticmethod
    def _seed(row: dict[str, Any] | None):
        if not row:
            return None
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "baseUrl": row["base_url"],
            "allowedHosts": list(row.get("allowed_hosts") or []),
            "includePatterns": list(row.get("include_patterns") or []),
            "excludePatterns": list(row.get("exclude_patterns") or []),
            "maxDepth": int(row.get("max_depth") or 4),
            "maxRequestsPerMinute": int(row.get("max_requests_per_minute") or 30),
            "maxConcurrency": int(row.get("max_concurrency") or 2),
            "maxPdfBytes": int(row.get("max_pdf_bytes") or 104857600),
            "crawlIntervalMinutes": int(row.get("crawl_interval_minutes") or 0),
            "enabled": bool(row.get("enabled", True)),
        }

    @staticmethod
    def _job(row: dict[str, Any] | None):
        if not row:
            return None
        return {
            "id": str(row["id"]),
            "seedSiteId": str(row["seed_site_id"]) if row.get("seed_site_id") else None,
            "triggerType": row["trigger_type"],
            "startUrl": row["start_url"],
            "status": row["status"],
            "pagesFetched": int(row.get("pages_fetched") or 0),
            "filesDiscovered": int(row.get("files_discovered") or 0),
            "filesDownloaded": int(row.get("files_downloaded") or 0),
            "duplicatesFound": int(row.get("duplicates_found") or 0),
            "errorsCount": int(row.get("errors_count") or 0),
            "errorSummary": row.get("error_summary"),
        }

    async def search_documents(self, query: str, limit: int = 20):
        normalized = unicodedata.normalize("NFKC", query)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        rows = await self.db.fetch_all(
            """
            SELECT d.*,
              GREATEST(
                CASE WHEN d.document_number_normalized = regexp_replace(%s, '\\s+', '', 'g') THEN 1.0 ELSE 0 END,
                similarity(COALESCE(d.preferred_title,''), %s),
                similarity(COALESCE(d.preferred_filename,''), %s),
                similarity(COALESCE(d.document_number_normalized,''), regexp_replace(%s, '\\s+', '', 'g'))
              ) AS score,
              COUNT(ds.id)::int AS source_count
            FROM documents d
            LEFT JOIN document_sources ds ON ds.document_id = d.id
            WHERE d.document_number_normalized = regexp_replace(%s, '\\s+', '', 'g')
               OR d.preferred_title ILIKE '%%' || %s || '%%'
               OR d.preferred_filename ILIKE '%%' || %s || '%%'
               OR similarity(COALESCE(d.preferred_title,''), %s) > 0.2
               OR similarity(COALESCE(d.document_number_normalized,''), regexp_replace(%s, '\\s+', '', 'g')) > 0.25
            GROUP BY d.id
            ORDER BY score DESC, d.last_seen_at DESC
            LIMIT %s
            """,
            (normalized, normalized, normalized, normalized, normalized, normalized, normalized, normalized, normalized, limit),
        )
        return [
            {
                "id": str(row["id"]),
                "sha256": row["sha256"],
                "storageKey": row["storage_key"],
                "mimeType": row.get("mime_type") or "application/pdf",
                "byteSize": int(row.get("byte_size") or 0),
                "title": row.get("preferred_title") or row.get("preferred_filename") or row.get("document_number") or "未命名 PDF",
                "filename": row.get("preferred_filename"),
                "documentNumber": row.get("document_number"),
                "score": float(row.get("score") or 0),
                "sourceCount": int(row.get("source_count") or 0),
            }
            for row in rows
        ]

    async def get_document(self, document_id: str):
        row = await self.db.fetch_one("SELECT * FROM documents WHERE id=%s LIMIT 1", (document_id,))
        if not row:
            return None
        return {
            "id": str(row["id"]),
            "sha256": row["sha256"],
            "storageKey": row["storage_key"],
            "mimeType": row.get("mime_type") or "application/pdf",
            "byteSize": int(row.get("byte_size") or 0),
            "title": row.get("preferred_title") or row.get("preferred_filename") or row.get("document_number") or "未命名 PDF",
            "filename": row.get("preferred_filename"),
            "documentNumber": row.get("document_number"),
        }

    async def get_document_blob(self, document_id: str):
        row = await self.db.fetch_one(
            """
            SELECT d.id, d.preferred_title, d.preferred_filename, b.content
            FROM documents d JOIN document_blobs b ON b.document_id=d.id
            WHERE d.id=%s LIMIT 1
            """,
            (document_id,),
        )
        if not row:
            return None
        return {
            "id": str(row["id"]),
            "title": row.get("preferred_title") or row.get("preferred_filename") or "document.pdf",
            "filename": row.get("preferred_filename"),
            "content": bytes(row["content"]),
        }

    async def upsert_document_blob(self, document_id: str, sha256: str, content: bytes):
        await self.db.execute(
            """
            INSERT INTO document_blobs (document_id, sha256, byte_size, content)
            VALUES (%s,%s,%s,%s)
            ON CONFLICT (document_id) DO UPDATE SET
              sha256=EXCLUDED.sha256, byte_size=EXCLUDED.byte_size,
              content=EXCLUDED.content, updated_at=now()
            """,
            (document_id, sha256, len(content), content),
        )
        await self.db.execute("UPDATE documents SET storage_backend='hybrid', updated_at=now() WHERE id=%s", (document_id,))

    async def list_seed_sites(self):
        rows = await self.db.fetch_all("SELECT * FROM seed_sites ORDER BY created_at ASC")
        return [self._seed(row) for row in rows]

    async def list_due_seed_sites(self, limit: int = 10):
        rows = await self.db.fetch_all(
            """
            SELECT s.*
            FROM seed_sites s
            WHERE s.enabled=TRUE
              AND s.crawl_interval_minutes > 0
              AND NOT EXISTS (
                SELECT 1 FROM crawl_jobs active
                WHERE active.seed_site_id=s.id
                  AND active.status IN ('queued','running')
              )
              AND COALESCE((
                SELECT MAX(COALESCE(history.finished_at, history.started_at))
                FROM crawl_jobs history
                WHERE history.seed_site_id=s.id
              ), '-infinity'::timestamptz)
                  <= now() - make_interval(mins => s.crawl_interval_minutes)
            ORDER BY COALESCE((
                SELECT MAX(COALESCE(history.finished_at, history.started_at))
                FROM crawl_jobs history
                WHERE history.seed_site_id=s.id
            ), '-infinity'::timestamptz) ASC, s.created_at ASC
            LIMIT %s
            """,
            (max(1, min(limit, 50)),),
        )
        return [self._seed(row) for row in rows]

    async def get_seed_site(self, seed_id: str):
        return self._seed(await self.db.fetch_one("SELECT * FROM seed_sites WHERE id=%s LIMIT 1", (seed_id,)))

    async def find_seed_for_host(self, hostname: str):
        row = await self.db.fetch_one(
            "SELECT * FROM seed_sites WHERE enabled=TRUE AND allowed_hosts ? %s ORDER BY created_at ASC LIMIT 1",
            (hostname.lower(),),
        )
        return self._seed(row)

    async def create_seed_site(self, data: dict[str, Any]):
        existing = await self.db.fetch_one(
            """
            SELECT * FROM seed_sites
            WHERE rtrim(base_url, '/') = rtrim(%s, '/')
            ORDER BY created_at ASC
            LIMIT 1
            """,
            (data["baseUrl"],),
        )
        if existing:
            return self._seed(existing)

        row = await self.db.fetch_one(
            """
            INSERT INTO seed_sites
              (name, base_url, allowed_hosts, include_patterns, exclude_patterns,
               max_depth, max_requests_per_minute, max_concurrency, max_pdf_bytes,
               crawl_interval_minutes)
            VALUES (%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                data["name"], data["baseUrl"], json.dumps(data["allowedHosts"]),
                json.dumps(data.get("includePatterns", [])), json.dumps(data.get("excludePatterns", [])),
                data.get("maxDepth", 4), data.get("maxRequestsPerMinute", 30),
                data.get("maxConcurrency", 2), data.get("maxPdfBytes", 104857600),
                data.get("crawlIntervalMinutes", 0),
            ),
        )
        return self._seed(row)

    async def update_seed_site(self, seed_id: str, **patch):
        mapping = {
            "name": "name",
            "allowed_hosts": "allowed_hosts",
            "include_patterns": "include_patterns",
            "exclude_patterns": "exclude_patterns",
            "max_depth": "max_depth",
            "max_requests_per_minute": "max_requests_per_minute",
            "max_concurrency": "max_concurrency",
            "max_pdf_bytes": "max_pdf_bytes",
            "crawl_interval_minutes": "crawl_interval_minutes",
            "enabled": "enabled",
        }
        json_fields = {"allowed_hosts", "include_patterns", "exclude_patterns"}
        sets: list[str] = []
        values: list[Any] = []
        for key, column in mapping.items():
            if key not in patch:
                continue
            if key in json_fields:
                sets.append(f"{column}=%s::jsonb")
                values.append(json.dumps(patch[key]))
            else:
                sets.append(f"{column}=%s")
                values.append(patch[key])
        if not sets:
            return await self.get_seed_site(seed_id)
        sets.append("updated_at=now()")
        values.append(seed_id)
        row = await self.db.fetch_one(
            f"UPDATE seed_sites SET {', '.join(sets)} WHERE id=%s RETURNING *",
            tuple(values),
        )
        return self._seed(row)

    async def create_crawl_job(self, seed_site_id: str | None, trigger_type: str, start_url: str):
        row = await self.db.fetch_one(
            "INSERT INTO crawl_jobs (seed_site_id,trigger_type,start_url,status) VALUES (%s,%s,%s,'queued') RETURNING *",
            (seed_site_id, trigger_type, start_url),
        )
        return self._job(row)

    async def create_crawl_job_if_idle(self, seed_site_id: str, trigger_type: str, start_url: str):
        row = await self.db.fetch_one(
            """
            INSERT INTO crawl_jobs (seed_site_id,trigger_type,start_url,status)
            SELECT %s,%s,%s,'queued'
            WHERE NOT EXISTS (
              SELECT 1 FROM crawl_jobs
              WHERE seed_site_id=%s AND status IN ('queued','running')
            )
            RETURNING *
            """,
            (seed_site_id, trigger_type, start_url, seed_site_id),
        )
        return self._job(row)

    async def _claim_search_discovery_job(self, db, *, normalized_url: str, start_url: str):
        active = await db.fetch_one(
            """
            SELECT * FROM crawl_jobs
            WHERE normalized_start_url=%s
              AND seed_site_id IS NULL
              AND trigger_type='discovery'
              AND status IN ('queued','running')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (normalized_url,),
        )
        if active:
            job = self._job(active)
            job["reused"] = True
            return job

        recent_ok = await db.fetch_one(
            """
            SELECT * FROM crawl_jobs
            WHERE normalized_start_url=%s
              AND seed_site_id IS NULL
              AND trigger_type='discovery'
              AND status IN ('succeeded','partial')
              AND created_at >= now() - interval '30 minutes'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (normalized_url,),
        )
        if recent_ok:
            job = self._job(recent_ok)
            job["reused"] = True
            return job

        recent_failed = await db.fetch_one(
            """
            SELECT * FROM crawl_jobs
            WHERE normalized_start_url=%s
              AND seed_site_id IS NULL
              AND trigger_type='discovery'
              AND status='failed'
              AND created_at >= now() - interval '5 minutes'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (normalized_url,),
        )
        if recent_failed:
            job = self._job(recent_failed)
            job["reused"] = True
            return job

        row = await db.fetch_one(
            """
            INSERT INTO crawl_jobs
              (seed_site_id, trigger_type, start_url, normalized_start_url, status)
            VALUES (NULL, 'discovery', %s, %s, 'queued')
            RETURNING *
            """,
            (start_url, normalized_url),
        )
        job = self._job(row)
        job["reused"] = False
        return job

    async def claim_search_discovery_job(self, *, normalized_url: str, start_url: str):
        transaction = getattr(self.db, "transaction", None)
        if transaction is None:
            return await self._claim_search_discovery_job(
                self.db,
                normalized_url=normalized_url,
                start_url=start_url,
            )

        async with transaction() as tx:
            await tx.fetch_one(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0)) AS locked",
                (normalized_url,),
            )
            return await self._claim_search_discovery_job(
                tx,
                normalized_url=normalized_url,
                start_url=start_url,
            )

    async def get_crawl_job(self, job_id: str):
        return self._job(await self.db.fetch_one("SELECT * FROM crawl_jobs WHERE id=%s LIMIT 1", (job_id,)))

    async def fail_interrupted_jobs(self):
        message = "worker restarted before completion"
        await self.db.execute(
            """
            UPDATE crawl_jobs
            SET status='failed',
                errors_count=GREATEST(COALESCE(errors_count, 0), 1),
                error_summary=CASE
                  WHEN COALESCE(error_summary, '') = '' THEN %s
                  ELSE left(error_summary || E'\n' || %s, 2000)
                END,
                finished_at=now()
            WHERE status IN ('queued','running')
            """,
            (message, message),
        )

    async def update_crawl_job(self, job_id: str, **patch):
        mapping = {
            "status": "status", "pages_fetched": "pages_fetched", "files_discovered": "files_discovered",
            "files_downloaded": "files_downloaded", "duplicates_found": "duplicates_found",
            "errors_count": "errors_count", "error_summary": "error_summary",
        }
        sets, values = [], []
        for key, column in mapping.items():
            if key in patch:
                sets.append(f"{column}=%s")
                values.append(patch[key])
        if patch.get("started"):
            sets.append("started_at=COALESCE(started_at,now())")
        if patch.get("finished"):
            sets.append("finished_at=now()")
        if not sets:
            return
        values.append(job_id)
        await self.db.execute(f"UPDATE crawl_jobs SET {', '.join(sets)} WHERE id=%s", tuple(values))

    async def record_crawl_page(self, *, job_id: str, url: str, normalized_url: str, status_code: int | None,
                                content_type: str | None, depth: int, page_title: str | None, error: str | None):
        await self.db.execute(
            """
            INSERT INTO crawl_pages (crawl_job_id,url,normalized_url,status_code,content_type,depth,page_title,error)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (crawl_job_id,normalized_url) DO UPDATE SET
              status_code=EXCLUDED.status_code, content_type=EXCLUDED.content_type,
              page_title=EXCLUDED.page_title, error=EXCLUDED.error, fetched_at=now()
            """,
            (job_id, url, normalized_url, status_code, content_type, depth, page_title, error),
        )

    async def upsert_discovered_link(self, *, url: str, normalized_url: str, referrer_url: str | None,
                                     source_host: str, anchor_text: str | None, likely_document: bool,
                                     ingestion_status: str):
        await self.db.execute(
            """
            INSERT INTO discovered_links
              (url,normalized_url,referrer_url,source_host,anchor_text,likely_document,ingestion_status)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (normalized_url) DO UPDATE SET
              url=EXCLUDED.url, referrer_url=COALESCE(EXCLUDED.referrer_url,discovered_links.referrer_url),
              anchor_text=COALESCE(EXCLUDED.anchor_text,discovered_links.anchor_text),
              likely_document=EXCLUDED.likely_document,
              ingestion_status=CASE WHEN discovered_links.ingestion_status='downloaded' THEN 'downloaded' ELSE EXCLUDED.ingestion_status END,
              last_seen_at=now()
            """,
            (url, normalized_url, referrer_url, source_host, anchor_text, likely_document, ingestion_status),
        )

    async def mark_discovered_status(self, normalized_url: str, status: str):
        await self.db.execute("UPDATE discovered_links SET ingestion_status=%s,last_seen_at=now() WHERE normalized_url=%s", (status, normalized_url))

    async def upsert_document_by_hash(self, *, sha256: str, storage_key: str, byte_size: int,
                                      preferred_title: str | None, preferred_filename: str | None,
                                      document_number: str | None):
        existing = await self.db.fetch_one("SELECT id FROM documents WHERE sha256=%s LIMIT 1", (sha256,))
        row = await self.db.fetch_one(
            """
            INSERT INTO documents
              (sha256,storage_key,mime_type,byte_size,preferred_title,preferred_filename,document_number,document_number_normalized)
            VALUES (%s,%s,'application/pdf',%s,%s,%s,%s,%s)
            ON CONFLICT (sha256) DO UPDATE SET
              last_seen_at=now(),updated_at=now(),
              preferred_title=COALESCE(documents.preferred_title,EXCLUDED.preferred_title),
              preferred_filename=COALESCE(documents.preferred_filename,EXCLUDED.preferred_filename),
              document_number=COALESCE(documents.document_number,EXCLUDED.document_number),
              document_number_normalized=COALESCE(documents.document_number_normalized,EXCLUDED.document_number_normalized)
            RETURNING *
            """,
            (sha256, storage_key, byte_size, preferred_title, preferred_filename, document_number,
             re.sub(r"\s+", "", document_number) if document_number else None),
        )
        return {"document": await self.get_document(str(row["id"])), "duplicate": existing is not None}

    async def upsert_document_source(self, *, document_id: str, source_url: str, normalized_source_url: str,
                                     source_host: str, referrer_url: str | None, anchor_text: str | None,
                                     http_filename: str | None, last_http_status: int | None):
        await self.db.execute(
            """
            INSERT INTO document_sources
              (document_id,source_url,normalized_source_url,source_host,referrer_url,anchor_text,http_filename,last_http_status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (document_id,normalized_source_url) DO UPDATE SET
              source_url=EXCLUDED.source_url,
              referrer_url=COALESCE(EXCLUDED.referrer_url,document_sources.referrer_url),
              anchor_text=COALESCE(EXCLUDED.anchor_text,document_sources.anchor_text),
              http_filename=COALESCE(EXCLUDED.http_filename,document_sources.http_filename),
              last_http_status=EXCLUDED.last_http_status,last_seen_at=now()
            """,
            (document_id, source_url, normalized_source_url, source_host, referrer_url, anchor_text, http_filename, last_http_status),
        )

    async def get_document_sources(self, document_id: str):
        rows = await self.db.fetch_all(
            "SELECT source_url,source_host,anchor_text,first_seen_at,last_seen_at FROM document_sources WHERE document_id=%s ORDER BY first_seen_at ASC",
            (document_id,),
        )
        return [
            {"sourceUrl": r["source_url"], "sourceHost": r["source_host"], "anchorText": r.get("anchor_text"),
             "firstSeenAt": str(r["first_seen_at"]), "lastSeenAt": str(r["last_seen_at"])}
            for r in rows
        ]
