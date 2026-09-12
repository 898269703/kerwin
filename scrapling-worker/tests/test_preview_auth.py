from fastapi.testclient import TestClient

from app.api import create_app


class Repo:
    async def list_seed_sites(self):
        return []


class Jobs:
    pass


def build_client(preview_token=None):
    app = create_app(
        repo=Repo(),
        jobs=Jobs(),
        api_token="unit-primary",
        preview_token=preview_token,
        health_check=lambda: True,
    )
    return TestClient(app)


def auth_header(value: str):
    return {"authorization": "Bearer " + value}


def test_primary_credential_still_authenticates_when_preview_credential_exists():
    response = build_client("unit-preview").get("/v1/seeds", headers=auth_header("unit-primary"))
    assert response.status_code == 200


def test_optional_preview_credential_authenticates_management_routes():
    response = build_client("unit-preview").get("/v1/seeds", headers=auth_header("unit-preview"))
    assert response.status_code == 200


def test_unknown_credential_is_rejected():
    response = build_client("unit-preview").get("/v1/seeds", headers=auth_header("unit-wrong"))
    assert response.status_code == 401


def test_missing_preview_credential_does_not_weaken_authentication():
    response = build_client("").get("/v1/seeds", headers=auth_header(""))
    assert response.status_code == 401
