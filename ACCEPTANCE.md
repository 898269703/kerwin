# PDF Finder acceptance record

Iteration: 2026-09-12 through 2026-09-14, frontend PDF proxy OIDC compatibility and production release. This record separates current-run evidence from historical checkpoints and records the bounded release independently from the wider crawler acceptance contract.

## Stage scope and evidence

| Stage | Evidence / scope | Status at contract creation |
| --- | --- | --- |
| Product | Root `PRODUCT.md`, `USER_FLOW.md`, `DATA_MODEL.md`; linked existing specs/plans | Bounded contract defined; proceed. |
| UX / Design System | Reuse current `frontend/app/page.tsx` and `globals.css`; no visual redesign | Existing implementation reused; desktop and 390 x 844 screenshot inspection passed. |
| Figma / Pixso | No editable-design work in the download-route fix | Not applicable. |
| MCP / external context | ChatGPT project history, GitHub remote, Vercel project, and Railway service state inspected | Current project ownership and deployment split verified; the reviewed release was deployed to both providers. |
| Implementation | File proxy shares existing server auth/base behavior; no schema/API shape change | Implemented on `codex/pdf-download-oidc-20260912`; focused tests cover the changed paths. |
| Run App | Next.js dev server at `http://127.0.0.1:3210` | Known-library query returned the expected PDF result. |
| Screenshot Visual QA | Desktop and 390 x 844 local-browser inspection | Passed for header, search field, examples, result card, preview/download actions, and console errors. |
| Tests / build | Commands and cases below | Frontend 33 tests/build/typecheck and worker 108 tests passed in this run and in provider builds. |
| Production readiness | Preview acceptance, merge, provider builds, live health, same-origin PDF bytes, and production browser search | The authentication/download slice is live and verified; the wider crawler contract remains open. |

## Required checks for this fix

- [x] Reproduce the original missing-OIDC failure with the targeted route test, then show the corrected test passes.
- [x] Explicit crawler base/API token still work and take precedence over OIDC; only server-to-worker requests contain authorization.
- [x] OIDC-only unit coverage uses the existing worker default and the current request-context token; Preview and production OIDC file downloads both returned the expected PDF bytes.
- [x] Invalid UUID returns 400 without fetching; absent credentials fail closed; missing upstream file returns 404; upstream failure/non-PDF content remains a controlled error.
- [x] Inline and `download=1` behavior, safe ASCII/Unicode filenames, PDF content type, security/cache headers, and byte integrity remain compatible.
- [x] Run from `frontend/`: focused tests, full test/build, and `npx tsc --noEmit` passed. Exact totals are recorded below.
- [x] Run from `scrapling-worker/`: the full pytest suite and `python -m compileall -q app` passed in an isolated Python 3.12 environment.
- [x] Run the app locally and verify known-library search; inspect retained layout on desktop and 390 x 844 viewports.
- [x] Verify a Vercel Preview built from the exact changed frontend source: search a known library document, open and download through the Preview same-origin file route, require a real PDF / `%PDF-`, and compare bytes or SHA256 against the worker file response.
- [x] Confirm inspected browser HTML does not expose crawler credential names or bearer values; worker management remains authenticated. Record only masked/status evidence.

## Existing wider release checks

The [search-miss specification](docs/superpowers/specs/2026-09-08-search-miss-auto-crawl-design.md), section 21, retains the wider feature acceptance: library hit avoids crawl; miss creates at most three bounded candidates; real counters update; terminal jobs refresh documents; dedupe/cooldown works; private targets are rejected; dependency failures preserve search; Preview passes before production promotion. Run and record applicable Preview checks independently. A passing PDF-proxy unit suite cannot satisfy this entire release contract.

The [V3 specification](docs/superpowers/specs/2026-09-08-scrapling-v3-design.md) also requires durable download after a worker restart, source cases, and rollback verification. A new deployment must not be called fully production-ready merely because health or a URL works.

## Historical evidence, not refreshed in this document

[`scrapling-worker/DEPLOYMENT_STATUS.md`](scrapling-worker/DEPLOYMENT_STATUS.md), dated 2026-09-08, records commit `9723c15cbdf09134a971b92a176b712be2ffd48d`, a successful Railway Scrapling deployment, W3C crawl/dedupe/progress and scheduler checks, and 45 passing worker tests for that release. It explicitly leaves frontend cutover open. Those results belong to that checkpoint and must not be reported as this iteration's result.

The existing specs/plans are scope references, not evidence that all their checkbox steps passed. Their older proposal headers and the V3 handoff's approval wording are retained as historical context.

## Current-run evidence

Source checkout: public GitHub repository `898269703/kerwin`, initial base `bd4b782`, implementation branch `codex/pdf-download-oidc-20260912`. PR `#1` merged into `crawler-mvp` as `b7f0888c2b5ac8839b45a1f19a5c3e8bf5e3a74f`. The unrelated dirty `Ai技经` workbench was not edited.

- `npm test -- library-file-route.test.ts crawler-client.test.ts`: 12 passed after the new tests first reproduced missing request-context OIDC support, Unicode filename handling, and unsanitized network failures.
- `npm run build`: 10 test files and 33 tests passed; Next.js 16.3.3 production build and route generation passed.
- `NODE_ENV=production npm run build`: the first Vercel Preview reproduced three `React.act` failures because Vitest inherited the production React runtime. The build script now forces `NODE_ENV=test` only for Vitest; the same production-environment command then passed 33 tests and the Next.js build.
- `npx tsc --noEmit`: passed.
- `/private/tmp/pdf-worker-tests-20260912/bin/python -m pytest -q`: 108 passed; one existing Starlette `anyio` deprecation warning.
- `/private/tmp/pdf-worker-tests-20260912/bin/python -m compileall -q app`: passed.
- `git diff --check`: passed before final staging.
- Local browser at `http://127.0.0.1:3210`: query `html40.pdf` returned exactly one existing-library result (`51957b6f-92ee-4785-98b5-9b2e34620c37`) with preview and download actions. Desktop and 390 x 844 screenshots showed no overlap or clipped primary controls; browser console remained empty.
- Existing live Railway worker, read-only verification: `/health` returned `{"ok":true}`; public search found the same document; PDF GET returned HTTP 200, `application/pdf`, 2,136,233 bytes, `%PDF-`, and SHA256 `49e01b35fa91aa9592ecef9dae362ddb60e217d21e59646bb19b52f806a8bbe0`.
- Codex Security diff scan `c6730e42-8391-4655-9732-aba0f4ce2940`: completed over four authentication/download surfaces with zero reportable findings. The scan records Preview OIDC verification as the remaining open question.
- Vercel Preview `dpl_7hrQrQbwfYeKrYrfNv6cb4NhFfog`, `https://pdf-search-bwcy9pg8c-kerwin98.vercel.app`: `READY`, `target: null`, no alias, 33 Vercel-build tests passed, and the Next.js build completed. Browser search returned the known library result; same-origin download produced `/Users/k/Downloads/html40.pdf`, 2,136,233 bytes, `%PDF-1.1`, and the exact worker SHA256 above. No Preview-origin console warnings/errors were recorded.
- The inspected Preview HTML contained no `CRAWLER_API_TOKEN`, `VERCEL_OIDC_TOKEN`, OIDC header name, or bearer value.
- Before release, Railway production configuration was rechecked after an operator-approved discard: the unrelated staged `npm start` and old `4baa38b` commit settings were gone, `staged` was `null`, and the then-running worker remained on successful deployment `3f81a0d5-fdb2-42d2-b949-bec40cbf6da9`. Its committed start command was the Uvicorn command and its source remained commit `1afdc33`; discarding the staged settings did not redeploy the service.
- PR `#1` merged at `b7f0888`; GitHub checks `PDF Finder Frontend CI / test-build` and `Scrapling Worker CI / test` passed before and after the merge.
- Railway production deployment `0a63566f-27b6-4852-b7bd-74078022fe58` completed successfully from the reviewed implementation tree, whose frontend and worker contents match merge commit `b7f0888`. Its build ran 108 worker tests, `compileall`, and dynamic verification; `/health` passed during deployment and `https://crawler-worker-production.up.railway.app/health` returned `{"ok":true}` afterward. A preceding CLI deployment `559ef54b-0ece-4bbf-a35f-2195a5201aeb` failed before build because the upload started below the configured `scrapling-worker` source root; redeploying from the repository root corrected it without replacing the healthy production instance during the failed attempt.
- The newly deployed worker served the known PDF with HTTP 200, 2,136,233 bytes, `%PDF-1.1`, and SHA256 `49e01b35fa91aa9592ecef9dae362ddb60e217d21e59646bb19b52f806a8bbe0` through a Vercel OIDC-authenticated Preview request.
- Vercel production deployment `dpl_5u2XxLmvh2HnR4q5ucETUq3GJbiy` is `READY` and aliased to `https://pdf-search-pwa.vercel.app`. Its build passed 10 files / 33 tests, TypeScript checking, and the Next.js production build; no runtime errors were reported in the first 30 minutes.
- Production browser search for `html40.pdf` returned exactly one verified library result with visible preview/download actions and no observed clipping or overlap. The production same-origin download returned HTTP 200, `application/pdf`, 2,136,233 bytes, `%PDF-1.1`, the same SHA256, `nosniff`, and a compatible ASCII plus UTF-8 content-disposition filename.

### 2026-09-14 SearXNG JSON recovery

- A production library-miss search exposed the user-visible fallback `深度查找暂时不可用`. Railway HTTP history showed every SearXNG `/search?format=json` request returning 403 from 2026-09-12 onward, while `/` still returned 200. The worker received no discovery-job request before the repair.
- The prior Railway image-service configuration declared JSON in an inline start command, but the image deployment did not execute that command. The running instance therefore used SearXNG's default HTML-only settings. Config-only redeployment `3a70967a-6576-4b9d-ab1c-c13333837e25` confirmed the 403 persisted. A diagnostic settings-path variable made the missing generated file explicit in deployment `9a56255d-869f-4d0d-9466-3c4793e9d3c9`; it was immediately reverted and service health was restored by `a66863d7-2c68-4980-87f8-f0382644f983`.
- `searxng/` now owns a reproducible image: upstream is pinned by digest, `settings.yml` is copied into the image, JSON is explicitly enabled, and the runtime signing secret is supplied only through Railway. The production secret was rotated without printing or committing its value.
- Local `docker build -t pdf-finder-searxng:test .` passed. The built image returned HTTP 200 `application/json`, 20 results for `电力工程 PDF`, and a valid SearXNG payload.
- Railway production deployment `afbb5dbb-1037-48bd-8465-d06f74456b2f` built the same Dockerfile and reached `SUCCESS`. Its live JSON endpoint returned HTTP 200 `application/json` with 39 results.
- Vercel production `POST /api/search` then returned 39 web results, `crawl.state = started`, three queued jobs, and no warning. Railway recorded all three authenticated `POST /v1/search-discovery/jobs` calls as HTTP 202 and subsequent status reads as HTTP 200. The jobs reached terminal states (`failed`, `succeeded`, `succeeded`) without status warnings; two successful jobs each downloaded one file.
- Browser QA on `https://pdf-search-pwa.vercel.app` showed 39 internet results and progressed from `正在准备深度查找…` to `深度查找已完成，暂未发现新的可下载 PDF。` without the unavailable fallback or layout overlap.

### 2026-09-14 crawler-result download closure

- [x] Reproduced the gap: successful discovery jobs incremented `filesDownloaded`, but the status route exposed only a second query-based library search, so unrelated filenames were omitted.
- [x] Added the additive `crawl_job_documents` result ledger and linked both new and deduplicated persisted PDFs to the executing job.
- [x] Protected job status now returns linked document metadata; the frontend promotes those exact documents to library cards and retains the older query refresh as migration compatibility.
- [x] Internet-source cards show `正在收录 PDF`, successful completion, or no-result state. Global progress reports checked pages, discovered PDFs, and persisted PDFs; completed library cards expose both `预览` and `下载`.
- [x] Frontend `npm test` passed 10 files / 34 tests; `npm run build` repeated 34 tests and passed TypeScript plus the Next.js production build.
- [x] Worker Docker build ran 111 tests, `compileall`, and Scrapling dynamic verification successfully.
- [x] Local production-server browser QA exercised the queued and completed states with a deterministic worker/search double. Desktop and 390 x 844 views showed the source-level crawl state, promoted library result, and visible preview/download controls without overlap; browser warnings/errors were empty.
- [x] Vercel Preview plus the deployed Worker showed a real search miss progressing to three linked library cards; same-origin preview and download returned a valid PDF.
- Railway production Worker deployment `23731117-81dc-46ed-bf58-93ede6a85c23` reached `SUCCESS` after its Docker build and `/health` rollout check; the live health endpoint returned `{"ok":true}`.
- Vercel Preview `dpl_5SjHeh1XwEokKfV84AyK6kXXKD1s`, `https://pdf-search-ok50xpwdk-kerwin98.vercel.app`, reached `READY` with `target: null`; its provider build passed 10 files / 34 tests and the Next.js build.
- Preview browser query `电力施工安全规程 DL5009 PDF` returned 35 internet results, marked three direct-PDF candidates as `正在收录 PDF`, and reached the successful completion state with three promoted library cards and 38 total results. Each promoted card exposed `预览` and `下载`; the corresponding source cards showed `已收录，可在本站结果下载`.
- The first promoted document opened in the browser PDF viewer as a 20-page PDF. Its same-origin download produced `45611f36d27a03a536adbaec89e150f583976f90.pdf`, 303,396 bytes, PDF 1.7, SHA256 `96743c326fe8912eb3127a371492ad96299c8cbdfbc0515f55777ddd404b3d32`.

## Remaining release work and risks

- Preview deployment `dpl_6WFoX81UdK6SJ6CSKfy12fNJryKV` was confirmed as `target: null` and failed before runtime with `BUILD_UTILS_SPAWN_1`; it is retained as evidence for the production-environment test-mode fix and is not a passed Preview.
- Railway currently reports `GitHub Repo not found` for the service connection, so repository-driven automatic worker deployments are not restored. This release used the official Railway CLI with the exact project, environment, and service selected.
- A separate Railway staging project was created, but the Trial resource limit rejected its Postgres service. It remains empty; no isolated staging deployment or production-data mutation occurred.
- Existing crawl orchestration can still outlast the UI polling window when three jobs run serially and stops polling on a transient status-request failure. Persisting the original query as document metadata is intentionally unnecessary: the job-result ledger now supplies exact completed downloads without weakening metadata provenance.
