from fastapi.testclient import TestClient
import pytest
from urllib.parse import unquote

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

    async def get_crawl_job(self, job_id: str):
        if job_id != "11111111-1111-1111-1111-111111111111":
            return None
        return {
            "id": job_id,
            "seedSiteId": None,
            "triggerType": "discovery",
            "startUrl": "https://example.gov/a.pdf",
            "status": "succeeded",
            "pagesFetched": 0,
            "filesDiscovered": 1,
            "filesDownloaded": 1,
            "duplicatesFound": 0,
            "errorsCount": 0,
            "errorSummary": None,
            "documents": [{
                "id": "51957b6f-1111-2222-3333-444444444444",
                "title": "html40.pdf",
                "filename": "html40.pdf",
                "documentNumber": None,
                "byteSize": 2136233,
                "sourceCount": 1,
            }],
        }

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
    def __init__(self):
        self.search_discovery_urls = []

    async def enqueue_seed(self, seed_site_id: str, start_url: str | None):
        if seed_site_id == "busy":
            raise RuntimeError("seed already has an active crawl job")
        return {"id": "job-1", "seedSiteId": seed_site_id, "status": "queued"}

    async def enqueue_search_discovery(self, url: str):
        if not url.startswith(("http://", "https://")):
            raise ValueError("only public HTTP(S) candidate URLs are allowed")
        self.search_discovery_urls.append(url)
        return {
            "id": "search-job-1",
            "seedSiteId": None,
            "triggerType": "discovery",
            "startUrl": url,
            "status": "queued",
            "reused": False,
        }


def client(jobs=None, oidc_verifier=None, api_token="secret"):
    jobs = jobs or FakeJobs()
    app = create_app(
        repo=FakeRepo(),
        jobs=jobs,
        api_token=api_token,
        health_check=lambda: True,
        oidc_verifier=oidc_verifier,
    )
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


@pytest.mark.parametrize("path, disposition", [
    ("/public/file?id=51957b6f-1111-2222-3333-444444444444", "inline"),
    ("/v1/documents/51957b6f-1111-2222-3333-444444444444/file", "attachment"),
])
@pytest.mark.parametrize("filename, title, expected_name", [
    ("预算定额.pdf", "ignored", "预算定额.pdf"),
    (None, "工程费用.pdf", "工程费用.pdf"),
    ('预算"定额\r\nX-Injected: yes/..\x00.pdf', "ignored", '预算_定额__X-Injected: yes_.._.pdf'),
])
def test_file_response_preserves_safe_unicode_filename(path, disposition, filename, title, expected_name):
    class FileRepo(FakeRepo):
        async def get_document_blob(self, document_id):
            blob = await super().get_document_blob(document_id)
            return {**blob, "filename": filename, "title": title}

    app = create_app(repo=FileRepo(), jobs=FakeJobs(), api_token="secret", health_check=lambda: True)
    response = TestClient(app, raise_server_exceptions=False).get(path, headers=auth())

    assert response.status_code == 200
    assert response.content == b"%PDF-test"
    assert response.headers["content-type"] == "application/pdf"
    header = response.headers["content-disposition"]
    assert header.startswith(f'{disposition}; filename="document.pdf"; filename*=UTF-8\'\'')
    assert header.isascii()
    assert all(32 <= ord(char) < 127 for char in header)
    assert unquote(header.split("filename*=UTF-8''", 1)[1]) == expected_name
    assert "x-injected" not in response.headers


@pytest.mark.parametrize("path, disposition", [
    ("/public/file?id=51957b6f-1111-2222-3333-444444444444", "inline"),
    ("/v1/documents/51957b6f-1111-2222-3333-444444444444/file", "attachment"),
])
def test_file_response_preserves_ascii_filename(path, disposition):
    response = client().get(path, headers=auth())
    assert response.status_code == 200
    assert response.headers["content-disposition"] == f'{disposition}; filename="html40.pdf"'
    assert response.content == b"%PDF-test"


def test_management_routes_require_bearer_token():
    r = client().get("/v1/seeds")
    assert r.status_code == 401
    assert r.json()["error"] == "unauthorized"


def test_crawl_job_status_includes_downloaded_documents():
    response = client().get(
        "/v1/crawl/jobs/11111111-1111-1111-1111-111111111111",
        headers=auth(),
    )

    assert response.status_code == 200
    document = response.json()["job"]["documents"][0]
    assert document["id"] == "51957b6f-1111-2222-3333-444444444444"
    assert document["filename"] == "html40.pdf"


def test_management_routes_accept_verified_vercel_oidc():
    r = client(oidc_verifier=lambda token: token == "valid-vercel-oidc").get(
        "/v1/seeds",
        headers={"authorization": "Bearer valid-vercel-oidc"},
    )
    assert r.status_code == 200
    assert r.json()["seeds"][0]["id"] == "seed-1"


def test_management_routes_accept_verified_oidc_without_fallback_bearer():
    r = client(oidc_verifier=lambda token: token == "valid-vercel-oidc", api_token="").get(
        "/v1/seeds",
        headers={"authorization": "Bearer valid-vercel-oidc"},
    )
    assert r.status_code == 200


def test_management_routes_reject_invalid_vercel_oidc():
    r = client(oidc_verifier=lambda token: False).get(
        "/v1/seeds",
        headers={"authorization": "Bearer invalid-vercel-oidc"},
    )
    assert r.status_code == 401


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


def test_search_discovery_requires_bearer_token():
    r = client().post(
        "/v1/search-discovery/jobs",
        json={"url": "https://example.gov/notices/123"},
    )
    assert r.status_code == 401


def test_search_discovery_rejects_invalid_scheme():
    r = client().post(
        "/v1/search-discovery/jobs",
        headers=auth(),
        json={"url": "file:///etc/passwd"},
    )
    assert r.status_code == 400
    assert "HTTP(S)" in r.json()["error"]


def test_search_discovery_enqueues_public_candidate():
    jobs = FakeJobs()
    r = client(jobs).post(
        "/v1/search-discovery/jobs",
        headers=auth(),
        json={"url": "https://example.gov/notices/123", "query": "156号", "mode": "auto"},
    )
    assert r.status_code == 202
    assert r.json()["job"]["startUrl"] == "https://example.gov/notices/123"
    assert r.json()["job"]["seedSiteId"] is None
    assert jobs.search_discovery_urls == ["https://example.gov/notices/123"]


def test_search_discovery_accepts_200_character_query():
    r = client().post(
        "/v1/search-discovery/jobs",
        headers=auth(),
        json={"url": "https://example.gov/notices/123", "query": "a" * 200},
    )
    assert r.status_code == 202


def test_search_discovery_rejects_query_over_200_characters():
    r = client().post(
        "/v1/search-discovery/jobs",
        headers=auth(),
        json={"url": "https://example.gov/notices/123", "query": "a" * 201},
    )
    assert r.status_code == 400


def test_search_discovery_rejects_unknown_mode():
    r = client().post(
        "/v1/search-discovery/jobs",
        headers=auth(),
        json={"url": "https://example.gov/notices/123", "mode": "deep"},
    )
    assert r.status_code == 400


def test_search_discovery_does_not_accept_safety_policy_overrides():
    r = client().post(
        "/v1/search-discovery/jobs",
        headers=auth(),
        json={
            "url": "https://example.gov/notices/123",
            "allowedHosts": ["internal.example"],
            "maxPages": 5000,
        },
    )
    assert r.status_code == 400
    assert "unsupported" in r.json()["error"]
