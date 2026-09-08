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
