# Scrapling deployment status

Updated: 2026-09-08

## Current branch state

- Repository: `898269703/kerwin`
- Branch: `crawler-mvp`
- Long-term crawler engine: Scrapling
- Service root: `scrapling-worker`
- Health endpoint: `/health`
- Target port: `3001`
- Latest accepted source commit: `9723c15cbdf09134a971b92a176b712be2ffd48d`

## Railway production checkpoint

- Project: `pdf-finder-search`
- Environment: `production`
- Current service slot: `crawler-worker`
- Scrapling deployment: `9ffbdb52-720b-47d4-b5df-6608a4a4cecf` — `SUCCESS`
- PostgreSQL migration is additive and has completed successfully in production.
- The Railway Free plan still prevents a true extra parallel green service, so `crawler-worker` is the current Scrapling slot rather than a separate sixth service.
- The legacy `crawler-worker/` source remains in the repository as the rollback code path.
- Vercel/frontend cutover has not happened yet.

## Verified crawler acceptance

The deterministic W3C HTML 4.0 corpus passed a real end-to-end crawl:

- final crawl status: `succeeded`
- pages fetched: `32`
- PDFs discovered: `2`
- PDFs downloaded: `2`
- crawler business errors: `0`
- live job progress updates verified
- direct PDF discovery/download and SHA-based dedupe verified
- recursive crawl path scope verified
- non-HTML resource filtering verified, including `.dtd`, `.ent`, and `.decl`
- misleading server MIME no longer overrides an explicit non-HTML asset URL type

## Reliability hardening verified

- Worker restart recovery closes orphaned `queued` and `running` jobs as `failed` with a clear restart reason.
- Historical runaway job `a166ce5a-cb13-42a4-b233-fd8fa3f443c5` was verified in production as recovered instead of remaining permanently active.
- New Seed creation is idempotent for equivalent base URLs that differ only by a trailing slash.
- Historical duplicate Seed rows were intentionally not deleted; production relationships/history are preserved.
- Job runtime, PDF count, dynamic-page count, global concurrency, and per-domain concurrency remain bounded.

## Seed management and embedded scheduler

Seed policy and scheduling are now built into the Scrapling worker, avoiding another Railway service:

- `PATCH /v1/seeds/{seed_id}` updates enablement, schedule interval, crawl limits, and include/exclude policy.
- `POST /v1/seeds/{seed_id}/run` starts a manual crawl.
- `crawlIntervalMinutes=0` disables automatic crawling; accepted recurring intervals are 5 minutes through 30 days.
- Scheduler poll defaults to 60 seconds and can be controlled by `SCHEDULER_ENABLED` / `SCHEDULER_POLL_SECONDS`.
- Due Seed selection ignores disabled/unscheduled Seeds and excludes Seeds with an active `queued` or `running` crawl.
- Job claiming is atomic so a Seed cannot receive duplicate active crawl jobs from scheduler/manual races.

Production smoke acceptance:

- Seed management PATCH returned `200` and persisted the interval.
- The primary test Seed was restored from 60 minutes to `0` immediately after management verification.
- A second test Seed was temporarily set to a 5-minute interval; without any manual run request, the worker began a real W3C crawl during the scheduler window.
- The test Seed was restored to `0` after the scheduler check.
- Final smoke marker: `managementOk=true`, `scheduleFieldOk=true`, `finalPrimaryInterval=0`, `finalAutoInterval=0`.
- No persistent scheduled test crawl remains enabled.

## CI

Latest full GitHub Actions / Railway build verification for the scheduler release:

- `45 passed`
- Python compile succeeded
- Scrapling dynamic verification succeeded

## Next cutover work

1. Search miss orchestration: library miss should be able to create a bounded crawl/discovery job instead of returning a dead end.
2. Expose job/search-session progress suitable for the frontend.
3. Update the PWA to show library hits immediately and crawl progress/results when discovery is needed.
4. Run production acceptance for the public search flow.
5. Only then cut frontend traffic to the Scrapling-backed flow.
