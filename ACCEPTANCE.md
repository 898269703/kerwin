# PDF Finder acceptance record

Iteration: 2026-09-12, frontend PDF proxy OIDC compatibility. This record separates current-run evidence from historical checkpoints and keeps the Preview and production gates open until their own checks pass.

## Stage scope and evidence

| Stage | Evidence / scope | Status at contract creation |
| --- | --- | --- |
| Product | Root `PRODUCT.md`, `USER_FLOW.md`, `DATA_MODEL.md`; linked existing specs/plans | Bounded contract defined; proceed. |
| UX / Design System | Reuse current `frontend/app/page.tsx` and `globals.css`; no visual redesign | Existing implementation reused; desktop and 390 x 844 screenshot inspection passed. |
| Figma / Pixso | No editable-design work in the download-route fix | Not applicable. |
| MCP / external context | ChatGPT project history, GitHub remote, Vercel project, and Railway service state inspected | Current project ownership and deployment split verified without changing production. |
| Implementation | File proxy shares existing server auth/base behavior; no schema/API shape change | Implemented on `codex/pdf-download-oidc-20260912`; focused tests cover the changed paths. |
| Run App | Next.js dev server at `http://127.0.0.1:3210` | Known-library query returned the expected PDF result. |
| Screenshot Visual QA | Desktop and 390 x 844 local-browser inspection | Passed for header, search field, examples, result card, preview/download actions, and console errors. |
| Tests / build | Commands and cases below | Frontend 33 tests/build/typecheck and worker 105 tests passed in this run. |
| Production readiness | Preserve production until Preview acceptance; no production cutover in this iteration | Whole-product production gate remains open. |

## Required checks for this fix

- [x] Reproduce the original missing-OIDC failure with the targeted route test, then show the corrected test passes.
- [x] Explicit crawler base/API token still work and take precedence over OIDC; only server-to-worker requests contain authorization.
- [x] OIDC-only unit coverage uses the existing worker default and the current request-context token. Real Preview OIDC remains a separate deployment check.
- [x] Invalid UUID returns 400 without fetching; absent credentials fail closed; missing upstream file returns 404; upstream failure/non-PDF content remains a controlled error.
- [x] Inline and `download=1` behavior, safe ASCII/Unicode filenames, PDF content type, security/cache headers, and byte integrity remain compatible.
- [x] Run from `frontend/`: focused tests, full test/build, and `npx tsc --noEmit` passed. Exact totals are recorded below.
- [x] Run from `scrapling-worker/`: the full pytest suite and `python -m compileall -q app` passed in an isolated Python 3.12 environment.
- [x] Run the app locally and verify known-library search; inspect retained layout on desktop and 390 x 844 viewports.
- [ ] Verify a Vercel Preview built from the exact changed source: search a known library document, open and download through the Preview same-origin file route, require HTTP 200 / `application/pdf` / `%PDF-`, and compare bytes or SHA256 against the worker file response.
- [ ] Confirm browser responses/assets do not expose crawler credentials; worker management remains authenticated. Record only masked/status evidence.

## Existing wider release checks

The [search-miss specification](docs/superpowers/specs/2026-09-08-search-miss-auto-crawl-design.md), section 21, retains the wider feature acceptance: library hit avoids crawl; miss creates at most three bounded candidates; real counters update; terminal jobs refresh documents; dedupe/cooldown works; private targets are rejected; dependency failures preserve search; Preview passes before production promotion. Run and record applicable Preview checks independently. A passing PDF-proxy unit suite cannot satisfy this entire release contract.

The [V3 specification](docs/superpowers/specs/2026-09-08-scrapling-v3-design.md) also requires durable download after a worker restart, source cases, and rollback verification. A new deployment must not be called fully production-ready merely because health or a URL works.

## Historical evidence, not refreshed in this document

[`scrapling-worker/DEPLOYMENT_STATUS.md`](scrapling-worker/DEPLOYMENT_STATUS.md), dated 2026-09-08, records commit `9723c15cbdf09134a971b92a176b712be2ffd48d`, a successful Railway Scrapling deployment, W3C crawl/dedupe/progress and scheduler checks, and 45 passing worker tests for that release. It explicitly leaves frontend cutover open. Those results belong to that checkpoint and must not be reported as this iteration's result.

The existing specs/plans are scope references, not evidence that all their checkbox steps passed. Their older proposal headers and the V3 handoff's approval wording are retained as historical context.

## Current-run evidence

Source checkout: public GitHub repository `898269703/kerwin`, base `bd4b782`, isolated branch `codex/pdf-download-oidc-20260912`. The unrelated dirty `Ai技经` workbench was not edited.

- `npm test -- library-file-route.test.ts crawler-client.test.ts`: 12 passed after the new tests first reproduced missing request-context OIDC support, Unicode filename handling, and unsanitized network failures.
- `npm run build`: 10 test files and 33 tests passed; Next.js 16.3.3 production build and route generation passed.
- `npx tsc --noEmit`: passed.
- `/private/tmp/pdf-worker-tests-20260912/bin/python -m pytest -q`: 105 passed; one existing Starlette `anyio` deprecation warning.
- `/private/tmp/pdf-worker-tests-20260912/bin/python -m compileall -q app`: passed.
- `git diff --check`: passed before final staging.
- Local browser at `http://127.0.0.1:3210`: query `html40.pdf` returned exactly one existing-library result (`51957b6f-92ee-4785-98b5-9b2e34620c37`) with preview and download actions. Desktop and 390 x 844 screenshots showed no overlap or clipped primary controls; browser console remained empty.
- Existing live Railway worker, read-only verification: `/health` returned `{"ok":true}`; public search found the same document; PDF GET returned HTTP 200, `application/pdf`, 2,136,233 bytes, `%PDF-`, and SHA256 `49e01b35fa91aa9592ecef9dae362ddb60e217d21e59646bb19b52f806a8bbe0`.
- Codex Security diff scan `c6730e42-8391-4655-9732-aba0f4ce2940`: completed over four authentication/download surfaces with zero reportable findings. The scan records Preview OIDC verification as the remaining open question.

## Remaining release work and risks

- A Vercel Preview built from the exact branch is still required for the same-origin search, preview, download, PDF signature, byte identity, and credential-exposure checks. Production has not been changed.
- The Unicode worker response fix has automated coverage but is not live until the Railway worker is deployed through a reviewed configuration. Existing unrelated Railway staged settings must not be accepted as part of this change.
- Existing crawl orchestration can still outlast the UI polling window when three jobs run serially, stops polling on a transient status-request failure, and may not persist the original direct-PDF query as searchable metadata. These are follow-up release risks outside this bounded authentication/download fix.
