# PDF Finder user flow

The full behavioral contract is the [existing search-miss design](docs/superpowers/specs/2026-09-08-search-miss-auto-crawl-design.md), sections 6 and 13–17. This iteration preserves these paths.

1. Open `/`. Enter a document number/title/topic or select an existing example. Submit search; the button reflects loading.
2. `POST /api/search` searches the library and public web sources. Library hits appear first and avoid automatic crawl creation. Results retain source labels, evidence/verification indicators, reasons, and source URLs.
3. With no library hit, the server may enqueue up to three bounded discovery candidates. Existing web results remain usable while a non-blocking panel shows queued/running counters.
4. The browser polls `/api/search/status`; that route reads worker status and never enqueues. After terminal jobs, refreshed library hits replace matching web candidates. Polling ends at terminal state or the existing client time budget.
5. A library result opens `/api/library/file?id=<document UUID>` inline or requests `download=1` for an attachment. The Next.js server authenticates to the worker and returns PDF bytes with a safe filename. No credential is returned to the browser.

For a library miss, the result list appears immediately while up to three bounded crawler jobs run. Each matching internet-source card shows its current ingestion state. When a job finishes, the status response carries the exact documents linked to that job; those documents are promoted into library cards with `预览` and `下载` actions even when the original search phrase is absent from the PDF filename or title.

## Download correction in this iteration

The server should use an explicitly configured `CRAWLER_API_TOKEN` first and otherwise the existing `VERCEL_OIDC_TOKEN` fallback, with the same base-URL behavior as the crawler client. A Preview with only the established OIDC configuration should open/download a known library PDF. The browser URL and result-card behavior stay unchanged.

## Existing edge states to preserve

- Invalid file UUID: HTTP 400; no worker request.
- No usable server credential: HTTP 503; no unauthenticated worker request.
- Missing stored document: HTTP 404.
- Upstream service failure or non-PDF response: controlled gateway/service error, without leaking credentials or upstream body details.
- Empty search: existing validation; no arbitrary crawler request.
- No search results: clear empty state. Worker/SearXNG failures retain any valid results and show the existing warning/unavailable state.
- Search replacement and polling completion: old progress must not overwrite a newer search; no duplicate enqueue loop.

Desktop/mobile acceptance follows the same sequence: load → search known library item → visible result → open/download → confirm real PDF response. A deterministic auto-crawl test, if run, is recorded separately from the download fix because it writes a job/document into the worker corpus.
