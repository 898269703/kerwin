# PDF Finder agent instructions

## Workflow and evidence gates

Use the AI App Factory workflow for app, site, tool, and product development. A read-only answer or a tiny bounded fix may reuse the existing product contract and design; name the reused assumptions and any intentionally skipped stages.

Work through applicable stages in order:

1. **Product:** read/update `PRODUCT.md`, `USER_FLOW.md`, `DATA_MODEL.md`, and `ACCEPTANCE.md`. Establish the goal, users, scenarios, constraints, entities, and acceptance criteria before design or implementation. Ask focused questions only for missing material decisions.
2. **UX / Design System:** define or reuse tokens, typography, spacing, colors, components, their states, and responsive behavior before UI implementation. Existing styles are in `frontend/app/globals.css`; preserve the approved reference when reproducing visuals.
3. **Figma / Pixso handoff:** when editable design is part of the task, prefer Auto Layout, Components, Variants, and Variables. If unavailable, document the intended structure and limitation before proceeding.
4. **MCP handoff:** discover and use relevant native connectors/tools where available. Preserve ownership and credential boundaries.
5. **Implementation:** first state the stack/framework boundaries, affected files, module ownership, persistence behavior, interaction/loading/empty/error states, and test strategy. New projects, substantial modules, and material architecture changes require comparable open-source/official-document research comparing license, maintenance, security risk, adaptation cost, and fit. A bounded fix may reuse existing decisions.
6. **Run App:** run the app after runtime, UI, build, backend, or deployment changes. Record the actual local URL or the specific blocker.
7. **Screenshot Visual QA:** for visual work, capture relevant desktop/mobile screenshots, compare against the target, fix actionable mismatches, and repeat. Check text fit, overlap, assets, controls, and stable interaction states. Documented gaps do not count as passed gates.
8. **Tests:** start with the narrowest useful checks, then broaden for shared behavior or production paths. Record exact commands and results. Run applicable unit/integration/browser checks, type/static checks, and production build. Do not claim unrun checks passed.
9. **Production readiness:** require product acceptance, applicable visual QA, tests/build, real deployment/runtime behavior, and relevant backend/database/environment/ownership verification. Report implementation, tested behavior, visual acceptance, and production verification separately; keep larger gates open when only a slice passes.

At each stage record completed work, evidence files/commands/screenshots/URLs, current risks, and whether the next stage can start. Consolidate evidence in `ACCEPTANCE.md` or the task's linked verification record. Gates are evidence requirements, not mandatory approval pauses: continue within the authorized objective without asking the user to say “continue.” Ask only for missing material inputs, external permissions, consequential scope changes, or destructive/irreversible actions. Preserve tool approval requirements and explicit stop requests.

## Verified repository facts (source inspection: 2026-09-12)

- `frontend/`: Next.js **16.3.3**, React 19, TypeScript, npm; `frontend/package.json` defines the current scripts.
- Browser entry: `frontend/app/page.tsx`; root metadata: `app/layout.tsx`; styling: `app/globals.css`; PWA manifest: `app/manifest.ts` (paths relative to `frontend/`).
- Frontend routes: `POST /api/search`, `GET /api/search/status`, `GET /api/library/file`. Server adapters/orchestration live in `frontend/lib/`; Vitest/Testing Library checks in `frontend/tests/`.
- `scrapling-worker/`: Python >=3.12; Scrapling **0.4.15**, FastAPI/Uvicorn, psycopg 3, httpx, PyJWT. `app/main.py` composes settings, database, repository, queue, auth, and API; `app/api.py` defines HTTP routes.
- `searxng/`: pinned upstream SearXNG image plus the checked-in settings required by the frontend JSON search adapter. Railway must provide `SEARXNG_SECRET`; never commit or print its value.
- Worker source is `scrapling-worker/app/`; SQL is `scrapling-worker/migrations/`; tests are `scrapling-worker/tests/`. PostgreSQL catalog and `document_blobs` preserve PDF bytes; `/data` is cache/temp, not the only durable copy.
- `crawler-worker/` is the legacy TypeScript/Crawlee rollback source according to the deployment checkpoint. Do not modernize, delete, or redeploy it as part of an unrelated frontend fix.
- GitHub CI definitions: `.github/workflows/frontend-ci.yml` and `.github/workflows/scrapling-ci.yml`.
- Generated/dependency output (`node_modules/`, `.next/`, Python virtual environments/caches) must not be edited or broadly staged. Preserve unrelated working changes. Never stage the entire checkout without inspection.

## Commands

Run frontend commands from `frontend/`:

```sh
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
npm test -- library-file-route.test.ts crawler-client.test.ts
npm test
npx tsc --noEmit
npm run build
npm start -- --hostname 127.0.0.1 --port 3000
```

`build` already runs Vitest before `next build`. There is currently no `lint` or `e2e` npm script; do not report those as existing commands. Use the available browser tooling for acceptance and record how it was run.

Run worker commands from `scrapling-worker/`, using an isolated Python environment:

```sh
python -m pip install -e '.[dev]'
python -m pytest -q
python -m compileall -q app
uvicorn app.main:app --host 127.0.0.1 --port 3001
```

Build the SearXNG service from `searxng/` and verify its JSON API before deployment:

```sh
docker build -t pdf-finder-searxng:test .
docker run --rm -p 127.0.0.1:18080:8080 -e SEARXNG_SECRET=local-test-only pdf-finder-searxng:test
curl --get --data-urlencode 'q=电力工程 PDF' --data-urlencode 'format=json' --data-urlencode 'categories=general' http://127.0.0.1:18080/search
```

The worker needs privately configured `DATABASE_URL` plus either `CRAWLER_API_TOKEN` or the complete Vercel OIDC trust configuration to start; dynamic browser execution also requires Scrapling's browser dependencies. `scrapling-worker/Dockerfile` documents the existing container install/build/start path. Do not use production credentials or mutate production data merely to satisfy local startup.

## Boundaries and deployment ownership

- Search is library-first; SearXNG discovers public candidates. Only the worker downloads, validates, deduplicates, and persists PDFs.
- Worker `/public/search` and `/public/file` are public read paths. All `/v1/*` management/document/job routes remain authenticated. Browser orchestration calls same-origin Next.js routes; crawler bearer/OIDC credentials stay server-side.
- `CRAWLER_API_TOKEN` takes precedence over `VERCEL_OIDC_TOKEN` for the existing server client. OIDC must be verified against the configured Vercel team/project/environment by the worker; missing/invalid credentials fail closed. Never relax auth to fix a download failure.
- Do not place secrets, auth headers, private source material, or full credential-bearing environment output into prompts, browser payloads, screenshots, logs, docs, or Git. No crawler credential may have a `NEXT_PUBLIC_` name.
- Preserve robots.txt, HTTP(S)/public-IP checks, redirect revalidation, provenance/host/path restrictions, runtime/page/PDF limits, PDF byte validation, SHA256 identity, and additive schema compatibility. Never bypass login, CAPTCHA, paywalls, or explicit access controls.
- Search-triggered crawling stays bounded by the existing spec: at most three candidates; no permanent seed creation; no browser-supplied safety-limit overrides. A crawler failure must leave valid search results usable.
- Formal PDFs and source provenance are authoritative evidence. Agent Memory and model inference are not source documents or PDF bytes. Never invent document metadata or successful downloads.
- `scrapling-worker/DEPLOYMENT_STATUS.md` is a **2026-09-08 historical checkpoint**, not proof of current live state. Its recorded Railway service is `crawler-worker` with source root `scrapling-worker`; the production PWA baseline is `pdf-search-pwa.vercel.app` in the search spec. Check actual ownership, deployment, environment, and runtime before acting or claiming success.
- Keep the existing production frontend until repository Preview acceptance passes; retain the previous deployment as rollback. Deploying a Preview and promoting production are distinct actions. No production alias cutover, destructive migration, or legacy retirement is part of the 2026-09-12 download-auth fix.

## Existing contracts and historical differences

Start with the four root product documents, then their linked specifications/plans. Reuse already implemented behavior for bounded iterations and update only affected parts. Record material architecture decisions under `docs/adr/` when new decisions are actually required.

The V3 handoff says the migration was approved, while specification headers still say “Proposed” / “Ready for user review.” Keep that historical distinction; neither wording establishes that every acceptance test passed. The handoff's `2026-09-08-scrapling-v3-implementation.md` reference is absent from this checkout; the available worker plan is `2026-09-08-scrapling-migration.md`. Some old prose names asyncpg, but the actual dependency and implementation use psycopg. Do not recreate old tasks or replace working modules based only on stale plan snippets.
