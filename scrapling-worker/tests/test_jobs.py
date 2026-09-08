import pytest

from app.jobs import JobRunner


class FakeRepo:
    def __init__(self):
        self.patches = []

    async def update_crawl_job(self, job_id, **patch):
        self.patches.append((job_id, patch))


@pytest.mark.asyncio
async def test_job_runner_marks_success_and_isolates_failures():
    repo = FakeRepo()
    calls = []

    async def run(job_id):
        calls.append(job_id)
        if job_id == "bad":
            raise RuntimeError("boom")

    runner = JobRunner(repo, run)
    await runner.run_one("good")
    await runner.run_one("bad")

    assert calls == ["good", "bad"]
    assert any(patch.get("status") == "succeeded" for _, patch in repo.patches)
    assert any(patch.get("status") == "failed" and "boom" in patch.get("error_summary", "") for _, patch in repo.patches)
