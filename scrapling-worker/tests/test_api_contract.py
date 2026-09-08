from fastapi.testclient import TestClient

from app.api import create_app


class FakeRepo:
    async def search_documents(self, query: str, limit: int = 20):
        if query == "html40.pdf":
            return [{
                "id": "51957b6f-1111-2222-3333-444444444444",
                "title": "html40.pdf",
                "filename": "html40.pdf",
                "documentNumber": None,
                "byteSize": 2136233,
                "sourceCount": 1,
                "score": 1.0,
            }]
        return []

    async def get_document_blob(self, document_id: str):
        if document_id.startswith("51957b6f"):
            return {
                "id": document_id,
                "title": "html40.pdf",
                "filename": "html40.pdf",
                "content": b"%PDF-test",
            }
        return None

    async def list_seed_sites(self):
        return [{
            "id": "seed-1",
            "name": "Example",
            "baseUrl": "https://example.com/docs/",
            "allowedHosts": ["example.com"],
            "includePatterns": [],
            "excludePatterns": [],
            "maxDepth": 2,
            "maxRequestsPerMinute": 30,
            "maxConcurrency": 1,
            "maxPdfBytes": 10_000_000,
            "crawlIntervalMinutes": 0,
            "enabled": True,
        }]

    async def update_seed_site(self, seed_id: str, **patch):
        if seed_id != "seed-1":
            return None
        return {
            "id": seed_id,
            "name": "Example",
            "baseUrl": "https://example.com/docs/",
            "allowedHosts": ["example.com"],
            "includePatterns": [],
            "excludePatterns": [],
            "maxDepth": 2,
            "maxRequestsPerMinute": 30,
            "maxConcurrency": 1,
            "maxPdfBytes": 10_000_000,
            "crawlIntervalMinutes": patch.get("crawl_interval_minutes", 0),
            "enabled": patch.get("enabled", True),
        }


class FakeJobs:
    async def enqueue_seed(self, seed_site_id: str, start_url: str | None):
        if seed_site_id == "busy":
            raise RuntimeError("seed already has an active crawl job")
        return {"id": "job-1", "seedSiteId": seed_site_id, "status": "queued"}


def client():
    app = create_app(repo=FakeRepo(), jobs=FakeJobs(), api_token="secret", health_check=lambda: True)
    return TestClient(app)


def auth():
    return {"authorization": "Bearer secret"}


def test_health_is_public():
    r = client().get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_public_search_keeps_existing_shape():
    r = client().get("/public/search", params={"q": "html40.pdf"})
    assert r.status_code == 200
    body = r.json()
    assert body["query"] == "html40.pdf"
    assert body["results"][0]["origin"] == "library"
    assert body["results"][0]["downloadPath"].startswith("/public/file?id=")


def test_public_file_returns_pdf_bytes():
    r = client().get("/public/file", params={"id": "51957b6f-1111-2222-3333-444444444444"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF-")


def test_management_routes_require_bearer_token():
    r = client().get("/v1/seeds")
    assert r.status_code == 401
    assert r.json()["error"] == "unauthorized"


def test_seed_policy_can_be_enabled_disabled_and_scheduled():
    r = client().patch(
        "/v1/seeds/seed-1",
        headers=auth(),
        json={"enabled": False, "crawlIntervalMinutes": 120},
    )
    assert r.status_code == 200
    assert r.json()["seed"]["enabled"] is False
    assert r.json()["seed"]["crawlIntervalMinutes"] == 120


def test_seed_schedule_rejects_too_frequent_interval():
    r = client().patch(
        "/v1/seeds/seed-1",
        headers=auth(),
        json={"crawlIntervalMinutes": 1},
    )
    assert r.status_code == 400
    assert "crawlIntervalMinutes" in r.json()["error"]


def test_manual_seed_run_returns_conflict_when_seed_is_already_active():
    r = client().post("/v1/seeds/busy/run", headers=auth())
    assert r.status_code == 409
    assert "active crawl job" in r.json()["error"]
