from __future__ import annotations

import inspect
import re
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response


_UUID = re.compile(r"^[0-9a-fA-F-]{36}$")


def _json(status: int, body: dict):
    return JSONResponse(status_code=status, content=body, headers={"cache-control": "no-store"})


def _safe_filename(value: str | None) -> str:
    name = re.sub(r'[\r\n"\\/]', "_", (value or "document.pdf")).strip()
    return name or "document.pdf"


async def _bool_result(fn) -> bool:
    value = fn()
    if inspect.isawaitable(value):
        value = await value
    return bool(value)


def _plain_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _schedule_interval(value) -> int | None:
    if not _plain_int(value):
        return None
    if value == 0:
        return 0
    return value if 5 <= value <= 43_200 else None


def _string_list(value, *, limit: int = 100) -> list[str] | None:
    if not isinstance(value, list) or len(value) > limit or not all(isinstance(v, str) for v in value):
        return None
    return [v for v in value if v]


def create_app(*, repo, jobs, api_token: str, health_check) -> FastAPI:
    app = FastAPI(title="PDF Finder Scrapling Worker", docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def protect_v1(request: Request, call_next):
        if request.url.path.startswith("/v1/") and request.headers.get("authorization", "") != f"Bearer {api_token}":
            return _json(401, {"error": "unauthorized"})
        return await call_next(request)

    @app.get("/health")
    async def health():
        ok = await _bool_result(health_check)
        return _json(200 if ok else 503, {"ok": ok})

    async def search_payload(q: str, limit: int, public: bool):
        rows = await repo.search_documents(q, max(1, min(limit, 20 if public else 50)))
        return {
            "query": q,
            "results": [
                {
                    "origin": "library",
                    "id": row["id"],
                    "title": row["title"],
                    "filename": row.get("filename"),
                    "documentNumber": row.get("documentNumber"),
                    "byteSize": row.get("byteSize", 0),
                    "sourceCount": row.get("sourceCount", 0),
                    "score": row.get("score", 0),
                    "downloadPath": f"/public/file?id={row['id']}" if public else f"/v1/documents/{row['id']}/file",
                }
                for row in rows
            ],
        }

    @app.get("/public/search")
    async def public_search(q: str = "", limit: int = 20):
        q = q.strip()
        if not q or len(q) > 200:
            return _json(400, {"error": "q is required and must be <= 200 characters"})
        return _json(200, await search_payload(q, limit, True))

    async def file_response(document_id: str, *, attachment: bool):
        if not _UUID.fullmatch(document_id):
            return _json(400, {"error": "valid id is required"})
        blob = await repo.get_document_blob(document_id)
        if not blob:
            return _json(404, {"error": "stored file missing"})
        content = blob["content"]
        filename = _safe_filename(blob.get("filename") or blob.get("title"))
        disposition = "attachment" if attachment else "inline"
        return Response(
            content=content,
            media_type="application/pdf",
            headers={
                "content-disposition": f'{disposition}; filename="{filename}"',
                "x-content-type-options": "nosniff",
                "cache-control": "private, max-age=0, must-revalidate" if attachment else "public, max-age=3600",
            },
        )

    @app.get("/public/file")
    async def public_file(id: str = ""):
        return await file_response(id.strip(), attachment=False)

    @app.get("/v1/documents/search")
    async def private_search(q: str = "", limit: int = 20):
        q = q.strip()
        if not q:
            return _json(400, {"error": "q is required"})
        return _json(200, await search_payload(q, limit, False))

    @app.get("/v1/documents/{document_id}/file")
    async def private_file(document_id: str):
        return await file_response(document_id, attachment=True)

    @app.get("/v1/documents/{document_id}")
    async def document_detail(document_id: str):
        doc = await repo.get_document(document_id)
        if not doc:
            return _json(404, {"error": "document not found"})
        return _json(200, {"document": doc, "sources": await repo.get_document_sources(document_id)})

    @app.get("/v1/crawl/jobs/{job_id}")
    async def get_job(job_id: str):
        job = await repo.get_crawl_job(job_id)
        return _json(200, {"job": job}) if job else _json(404, {"error": "job not found"})

    @app.post("/v1/crawl/jobs")
    async def create_job(request: Request):
        body = await request.json()
        seed_id = body.get("seedSiteId") if isinstance(body, dict) else None
        if not isinstance(seed_id, str) or not seed_id:
            return _json(400, {"error": "seedSiteId is required"})
        try:
            job = await jobs.enqueue_seed(seed_id, body.get("startUrl") if isinstance(body.get("startUrl"), str) else None)
        except LookupError as exc:
            return _json(404, {"error": str(exc)})
        except RuntimeError as exc:
            return _json(409, {"error": str(exc)})
        return _json(202, {"job": job})

    @app.post("/v1/search-discovery/jobs")
    async def create_search_discovery_job(request: Request):
        body = await request.json()
        if not isinstance(body, dict):
            return _json(400, {"error": "JSON object required"})

        known = {"url", "query", "mode"}
        unknown = sorted(set(body) - known)
        if unknown:
            return _json(400, {"error": f"unsupported search discovery settings: {', '.join(unknown)}"})

        source_url = body.get("url")
        query = body.get("query", "")
        mode = body.get("mode", "auto")
        if not isinstance(source_url, str) or not source_url.strip():
            return _json(400, {"error": "url is required"})
        if not isinstance(query, str) or len(query) > 200:
            return _json(400, {"error": "query must be <= 200 characters"})
        if mode != "auto":
            return _json(400, {"error": "mode must be auto"})
        try:
            job = await jobs.enqueue_search_discovery(source_url.strip())
        except ValueError as exc:
            return _json(400, {"error": str(exc)})
        return _json(202, {"job": job})

    @app.post("/v1/ingest")
    async def ingest(request: Request):
        body = await request.json()
        source_url = body.get("url") if isinstance(body, dict) else None
        if not isinstance(source_url, str) or not source_url.strip():
            return _json(400, {"error": "url is required"})
        parsed = urlsplit(source_url.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return _json(400, {"error": "only HTTP(S) URLs are allowed"})
        try:
            job = await jobs.enqueue_ingest(source_url.strip(), body.get("referrerUrl") if isinstance(body.get("referrerUrl"), str) else None)
        except LookupError as exc:
            return _json(400, {"error": str(exc)})
        return _json(202, {"job": job})

    @app.get("/v1/seeds")
    async def seeds():
        return _json(200, {"seeds": await repo.list_seed_sites()})

    @app.post("/v1/seeds")
    async def create_seed(request: Request):
        body = await request.json()
        if not isinstance(body, dict) or not isinstance(body.get("name"), str) or not isinstance(body.get("baseUrl"), str):
            return _json(400, {"error": "name and baseUrl are required"})
        parsed = urlsplit(body["baseUrl"])
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return _json(400, {"error": "only HTTP(S) seed URLs are allowed"})
        interval = _schedule_interval(body.get("crawlIntervalMinutes", 0))
        if interval is None:
            return _json(400, {"error": "crawlIntervalMinutes must be 0 or between 5 and 43200"})
        host = parsed.hostname.lower()
        allowed = [v.lower() for v in body.get("allowedHosts", []) if isinstance(v, str)]
        if host not in allowed:
            allowed.append(host)
        seed = await repo.create_seed_site({
            "name": body["name"], "baseUrl": body["baseUrl"], "allowedHosts": allowed,
            "includePatterns": [v for v in body.get("includePatterns", []) if isinstance(v, str)],
            "excludePatterns": [v for v in body.get("excludePatterns", []) if isinstance(v, str)],
            "maxDepth": body.get("maxDepth", 4), "maxRequestsPerMinute": body.get("maxRequestsPerMinute", 30),
            "maxConcurrency": body.get("maxConcurrency", 2), "maxPdfBytes": body.get("maxPdfBytes", 104857600),
            "crawlIntervalMinutes": interval,
        })
        return _json(201, {"seed": seed})

    @app.patch("/v1/seeds/{seed_id}")
    async def update_seed(seed_id: str, request: Request):
        body = await request.json()
        if not isinstance(body, dict) or not body:
            return _json(400, {"error": "at least one seed setting is required"})

        patch = {}
        if "name" in body:
            if not isinstance(body["name"], str) or not body["name"].strip() or len(body["name"].strip()) > 200:
                return _json(400, {"error": "name must be a non-empty string <= 200 characters"})
            patch["name"] = body["name"].strip()
        if "enabled" in body:
            if not isinstance(body["enabled"], bool):
                return _json(400, {"error": "enabled must be boolean"})
            patch["enabled"] = body["enabled"]
        if "crawlIntervalMinutes" in body:
            interval = _schedule_interval(body["crawlIntervalMinutes"])
            if interval is None:
                return _json(400, {"error": "crawlIntervalMinutes must be 0 or between 5 and 43200"})
            patch["crawl_interval_minutes"] = interval

        int_rules = {
            "maxDepth": ("max_depth", 0, 10),
            "maxRequestsPerMinute": ("max_requests_per_minute", 1, 600),
            "maxConcurrency": ("max_concurrency", 1, 2),
            "maxPdfBytes": ("max_pdf_bytes", 1_048_576, 104_857_600),
        }
        for input_name, (repo_name, minimum, maximum) in int_rules.items():
            if input_name not in body:
                continue
            value = body[input_name]
            if not _plain_int(value) or value < minimum or value > maximum:
                return _json(400, {"error": f"{input_name} must be between {minimum} and {maximum}"})
            patch[repo_name] = value

        for input_name, repo_name in (("includePatterns", "include_patterns"), ("excludePatterns", "exclude_patterns")):
            if input_name not in body:
                continue
            values = _string_list(body[input_name])
            if values is None:
                return _json(400, {"error": f"{input_name} must be an array of at most 100 strings"})
            patch[repo_name] = values

        known = {"name", "enabled", "crawlIntervalMinutes", *int_rules.keys(), "includePatterns", "excludePatterns"}
        unknown = sorted(set(body) - known)
        if unknown:
            return _json(400, {"error": f"unsupported seed settings: {', '.join(unknown)}"})
        if not patch:
            return _json(400, {"error": "no valid seed settings supplied"})

        seed = await repo.update_seed_site(seed_id, **patch)
        return _json(200, {"seed": seed}) if seed else _json(404, {"error": "seed not found"})

    @app.post("/v1/seeds/{seed_id}/run")
    async def run_seed(seed_id: str):
        try:
            job = await jobs.enqueue_seed(seed_id, None)
        except LookupError as exc:
            return _json(404, {"error": str(exc)})
        except RuntimeError as exc:
            return _json(409, {"error": str(exc)})
        return _json(202, {"job": job})

    return app
