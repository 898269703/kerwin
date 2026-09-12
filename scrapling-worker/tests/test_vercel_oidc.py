from types import SimpleNamespace
from unittest.mock import Mock

import jwt
import pytest

from app.vercel_oidc import VercelOidcConfig, VercelOidcVerifier


@pytest.fixture
def config():
    return VercelOidcConfig(
        team_slug="kerwin98",
        team_id="team_WbroE8YeTj77Wkw8YjsUUhCK",
        project_id="prj_J4V3KqkXpcLmfoDaV6cvngZ8sLQc",
        allowed_environments=("preview", "production"),
    )


@pytest.fixture
def claims():
    return {
        "iss": "https://oidc.vercel.com/kerwin98",
        "aud": "https://vercel.com/kerwin98",
        "sub": "owner:kerwin98:project:pdf-search-pwa:environment:preview",
        "owner_id": "team_WbroE8YeTj77Wkw8YjsUUhCK",
        "project_id": "prj_J4V3KqkXpcLmfoDaV6cvngZ8sLQc",
        "environment": "preview",
        "iat": 1_800_000_000,
        "exp": 1_800_000_300,
    }


def verifier(config):
    jwks = Mock()
    jwks.get_signing_key_from_jwt.return_value = SimpleNamespace(key="public-key")
    return VercelOidcVerifier(config, jwks_client=jwks), jwks


def test_oidc_endpoints_are_team_scoped(config):
    assert config.issuer == "https://oidc.vercel.com/kerwin98"
    assert config.audience == "https://vercel.com/kerwin98"
    assert config.jwks_url == "https://oidc.vercel.com/kerwin98/.well-known/jwks"


@pytest.mark.asyncio
async def test_accepts_valid_vercel_project_token(config, claims, monkeypatch):
    subject, jwks = verifier(config)
    decode = Mock(return_value=claims)
    monkeypatch.setattr("app.vercel_oidc.jwt.decode", decode)

    assert await subject("signed-token") is True
    jwks.get_signing_key_from_jwt.assert_called_once_with("signed-token")
    decode.assert_called_once_with(
        "signed-token",
        "public-key",
        algorithms=["RS256"],
        issuer=config.issuer,
        audience=config.audience,
        options={"require": ["exp", "iat", "iss", "aud", "sub"]},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("owner_id", "team_other"),
        ("project_id", "prj_other"),
        ("environment", "development"),
        ("sub", "owner:other:project:pdf-search-pwa:environment:preview"),
    ],
)
async def test_rejects_token_from_wrong_vercel_scope(config, claims, monkeypatch, field, value):
    subject, _ = verifier(config)
    invalid = {**claims, field: value}
    monkeypatch.setattr("app.vercel_oidc.jwt.decode", Mock(return_value=invalid))

    assert await subject("signed-token") is False


@pytest.mark.asyncio
async def test_rejects_invalid_signature(config, monkeypatch):
    subject, _ = verifier(config)
    monkeypatch.setattr(
        "app.vercel_oidc.jwt.decode",
        Mock(side_effect=jwt.InvalidSignatureError("bad signature")),
    )

    assert await subject("signed-token") is False
