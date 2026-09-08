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
        })
        return _json(201, {"seed": seed})

    return app
