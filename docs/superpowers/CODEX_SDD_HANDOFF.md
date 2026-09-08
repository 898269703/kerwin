# Codex SDD Handoff — PDF Finder Scrapling V3

## Objective
Execute the approved Scrapling V3 blue/green migration for PDF Finder using Superpowers Subagent-Driven Development.

## Authoritative documents
1. Spec: `docs/superpowers/specs/2026-09-08-scrapling-v3-design.md`
2. Plan: `docs/superpowers/plans/2026-09-08-scrapling-v3-implementation.md`

The spec is binding. The implementation plan is the task-by-task execution guide.

## Repository / branch
- Repository: `898269703/kerwin`
- Working branch: `crawler-mvp`
- Do NOT implement on `master`.
- Create an isolated worktree/feature branch for implementation before touching code.

## Required workflow
1. Read `superpowers:using-superpowers`.
2. Read `superpowers:subagent-driven-development`.
3. Read `superpowers:using-git-worktrees` and create an isolated workspace.
4. Initialize the SDD ledger for the implementation plan.
5. Read the approved spec once, then the implementation plan once.
6. Execute Task 1 through Task 15 continuously.
7. For every task:
   - fresh implementer subagent;
   - RED test first;
   - minimal GREEN implementation;
   - full relevant regression tests;
   - commit;
   - fresh task reviewer for spec compliance + code quality;
   - fix/re-review loop until approved.
8. After all tasks, run a broad whole-branch review using the most capable available model.
9. Read and apply `superpowers:verification-before-completion` before claiming success.
10. Use `superpowers:finishing-a-development-branch` only after final verification.

## Locked architecture decisions
- Long-term crawler engine: Scrapling only.
- Crawlee remains rollback-only during blue/green migration and is retired after the observation window.
- Python: 3.12.
- Scrapling: 0.4.15 for first production V3.
- FastAPI + Uvicorn.
- asyncpg + existing PostgreSQL schema.
- `document_blobs` BYTEA is durable PDF fallback; `/data` is cache/temp, not source of truth.
- SHA256 remains document identity.
- Vercel/frontend API contract must remain compatible.
- SearXNG remains discovery/fallback, not the document repository.
- HTTP first; bounded dynamic-browser fallback only when needed.
- No default Stealth mode; never bypass login, CAPTCHA, paywalls, or explicit access controls.
- Respect robots.txt, host allowlists, rate limits, SSRF/private-network checks, redirect revalidation, max file size, MIME and `%PDF-` validation.

## Existing production context
- Existing TypeScript/Crawlee service: `crawler-worker`
- Existing repository directory: `crawler-worker/`
- New implementation must live in: `scrapling-worker/`
- Existing public API includes `/health`, `/public/search`, `/public/file`.
- Protected API includes `/v1/crawl/jobs`, `/v1/ingest`, document/search/job/seed routes.
- Existing schema includes `seed_sites`, `crawl_jobs`, `crawl_pages`, `documents`, `document_blobs`, `document_sources`, `discovered_links`.
- Do not delete or rename existing schema fields during migration.

## Acceptance gates before production cutover
- Full pytest suite green.
- Static HTML traversal works.
- Non-`.pdf` download endpoint detection works.
- Dynamic JS attachment fallback works within budget.
- robots/SSRF/redirect/private-network tests green.
- SHA256 dedupe preserves one physical/logical document with multiple sources.
- Existing TypeScript-created rows remain readable.
- API contract matches existing frontend expectations.
- W3C `html40.pdf` baseline succeeds and dedupes against the existing document.
- Approved Chinese public-source smoke test succeeds.
- PDF remains downloadable after Scrapling worker restart with `/data` treated as disposable.
- Vercel is not switched to Scrapling until every production gate passes.
- Rollback to Crawlee remains available throughout the observation window.

## First action
Start with Task 1 from the implementation plan: create the isolated `scrapling-worker/` Python skeleton and configuration contract using TDD. Do not skip directly to Railway deployment.

## Controller instruction
Run continuously without asking the user to confirm between tasks. Stop only for an irreversible/destructive action, a security-sensitive action, an external side effect requiring confirmation, or a genuinely broken plan where every path forward is a guess.
