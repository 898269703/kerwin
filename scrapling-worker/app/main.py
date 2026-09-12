from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from .api import create_app
from .config import Settings
from .database import Database, migration_paths
from .jobs import CrawlerJobs
from .repository import Repository
from .vercel_oidc import VercelOidcConfig, VercelOidcVerifier


settings = Settings.from_env()
db = Database(settings.database_url)
repo = Repository(db)
jobs = CrawlerJobs(repo, settings)


def build_oidc_verifier():
    if not settings.vercel_oidc_enabled:
        return None
    return VercelOidcVerifier(VercelOidcConfig(
        team_slug=settings.vercel_oidc_team_slug,
        team_id=settings.vercel_oidc_team_id,
        project_id=settings.vercel_oidc_project_id,
        allowed_environments=settings.vercel_oidc_environments,
    ))


async def health_check() -> bool:
    return await db.ping()


app = create_app(
    repo=repo,
    jobs=jobs,
    api_token=settings.api_token,
    preview_token=settings.preview_token,
    oidc_verifier=build_oidc_verifier(),
    health_check=health_check,
)


@asynccontextmanager
async def lifespan(_app):
    await db.open()
    migration_dir = Path(__file__).resolve().parent.parent / "migrations"
    for migration in migration_paths(migration_dir):
        await db.migrate(str(migration))
    await jobs.start()
    try:
        yield
    finally:
        await jobs.stop()
        await db.close()


app.router.lifespan_context = lifespan
