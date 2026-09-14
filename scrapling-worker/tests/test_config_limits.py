import pytest

from app.config import Settings


def _set_required_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://example/db")
    monkeypatch.setenv("CRAWLER_API_TOKEN", "test-token")


def test_default_pdf_limit_is_one_hundred(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.delenv("MAX_PDFS_PER_JOB", raising=False)

    settings = Settings.from_env()

    assert settings.max_pdfs_per_job == 100


def test_runtime_limits_are_clamped_to_v3_safety_caps(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("MAX_PDFS_PER_JOB", "999")
    monkeypatch.setenv("GLOBAL_CONCURRENCY", "999")
    monkeypatch.setenv("PER_DOMAIN_CONCURRENCY", "999")
    monkeypatch.setenv("MAX_DYNAMIC_PAGES", "999")

    settings = Settings.from_env()

    assert settings.max_pdfs_per_job == 100
    assert settings.global_concurrency == 6
    assert settings.per_domain_concurrency == 2
    assert settings.max_dynamic_pages == 20


def test_oidc_only_authentication_does_not_require_fallback_bearer(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://example/db")
    monkeypatch.delenv("CRAWLER_API_TOKEN", raising=False)
    monkeypatch.setenv("VERCEL_OIDC_TEAM_SLUG", "example-team")
    monkeypatch.setenv("VERCEL_OIDC_TEAM_ID", "team_example")
    monkeypatch.setenv("VERCEL_OIDC_PROJECT_ID", "prj_example")
    monkeypatch.setenv("VERCEL_OIDC_ENVIRONMENTS", "preview")

    settings = Settings.from_env()

    assert settings.api_token == ""
    assert settings.vercel_oidc_enabled is True


def test_configuration_rejects_missing_bearer_and_incomplete_oidc(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://example/db")
    monkeypatch.delenv("CRAWLER_API_TOKEN", raising=False)
    monkeypatch.setenv("VERCEL_OIDC_TEAM_SLUG", "example-team")
    monkeypatch.delenv("VERCEL_OIDC_TEAM_ID", raising=False)
    monkeypatch.delenv("VERCEL_OIDC_PROJECT_ID", raising=False)

    with pytest.raises(RuntimeError, match="authentication is required"):
        Settings.from_env()
