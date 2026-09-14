# PDF Finder user flow

Updated: 2026-09-14. This flow supersedes the automatic search-miss trigger in the historical design while reusing its Worker, validation, job ledger, progress, and download behavior.

1. Open `/`, enter a document number, title, or topic, and submit. The new search clears any prior selection and stops polling that older search in this browser; already-submitted backend jobs continue independently.
2. `POST /api/search` queries the owned library and the public web. Verified library files appear first with preview/download actions. Internet candidates retain source labels, verification indicators, reasons, and external links. Search itself creates no crawl job and persists nothing.
3. Each internet candidate has `选择此来源`. The user may select one to three unique sources. At three selections, other unchecked candidates are disabled until one is deselected.
4. The sticky selection panel shows the selected count and enables `开始爬取`. Clicking it sends the current query and exactly the selected URLs to `POST /api/crawl`. The server validates the query and public HTTP(S) URLs, then authenticates to the existing Worker. Credentials never enter browser responses or state.
5. Each accepted source receives its own progress row. While the page is visible, the browser polls `/api/search/status` every second and displays real checked-page, discovered-PDF, and persisted-PDF counters. A hidden page polls more slowly. No percentage is shown because a crawl's total work is unknown.
6. Jobs end as succeeded, partial, or failed. The status response carries the exact documents linked to those jobs. Persisted documents are promoted into library cards with `预览` and `下载`; web candidates remain available as provenance. A completed batch clears the selection so another batch can be chosen.
7. A library action uses `/api/library/file?id=<document UUID>` for inline preview or adds `download=1` for attachment download. The Next.js server authenticates to the Worker and returns validated PDF bytes with a safe filename.

## Edge states

- Empty or oversized queries are rejected without a search or crawler request.
- Zero internet results shows the existing empty/library-only state and no crawl controls.
- A malformed, credential-bearing, duplicate, non-HTTP(S), local/private, or more-than-three URL selection is rejected before Worker submission. The Worker remains authoritative for DNS, redirect, network-scope, byte-size, and PDF-content validation.
- If only some selected jobs can start, accepted jobs continue and the UI shows a warning. If none start, candidates and selection remain available for retry.
- A transient status error is retried twice. If status stays unavailable or the five-minute browser budget expires, the UI explains that backend work can continue and recommends a later library search.
- Starting a new search invalidates older frontend responses so their progress cannot overwrite the new results.
- Missing stored documents, upstream failure, or non-PDF content remain controlled server errors without credential or upstream-body leakage.

Desktop and mobile acceptance follow the same sequence: search → review candidates → select → start → observe independent progress → preview/download a persisted PDF.
