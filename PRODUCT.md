# PDF Finder product contract

Updated: 2026-09-14. This is a concise index of the existing product and the current bounded continuation, not a new architecture proposal.

## Product and users

Help people find public technical PDFs by document title, number, or topic. Each search queries the owned PDF library and the public web, puts verified library files first, and keeps visible source provenance. Internet candidates are never ingested merely because they appeared in search: the user chooses up to three sources and explicitly starts crawling. A persisted library result opens or downloads actual PDF bytes through the application's own route. Public search users do not need crawler management credentials; authorized operators manage seeds and jobs through protected worker APIs.

## Existing contract reused

- [Search-miss automatic crawl design](docs/superpowers/specs/2026-09-08-search-miss-auto-crawl-design.md): library-first search, bounded background discovery, progress, refreshed library results, failures, and Preview gates.
- [Scrapling V3 design](docs/superpowers/specs/2026-09-08-scrapling-v3-design.md): crawling, validation, source provenance, SHA256 identity, PostgreSQL durability, compatibility, and rollback.
- [Frontend implementation plan](docs/superpowers/plans/2026-09-08-pdf-finder-frontend-auto-crawl-implementation.md) and [worker discovery plan](docs/superpowers/plans/2026-09-08-search-discovery-worker-implementation.md) describe the existing feature scope.
- [SDD handoff](docs/superpowers/CODEX_SDD_HANDOFF.md) records V3 approval. The specifications retain their earlier proposal/review headers. These documents describe intended/approved scope; their checklist text is not current test evidence.

## Current iteration

Replace automatic search-triggered ingestion with a user-selected workflow. `POST /api/search` returns library and internet candidates without creating jobs. A separate server route accepts one to three selected public HTTP(S) sources, submits only those sources to the existing authenticated Worker, and returns job identities. The page polls real Worker counters every second while visible and shows each source as queued, running, succeeded, partial, or failed. Completed job-linked documents become library cards with preview and download actions. [ACCEPTANCE.md](ACCEPTANCE.md) owns the evidence checklist.

Constraints: keep source-visible search and the existing Chinese design system; keep bearer/OIDC credentials server-only; preserve Worker SSRF, redirect, scope, size, PDF-byte, deduplication, and provenance checks; reject malformed, duplicate, private, or more than three selected URLs before Worker submission; keep existing document identity and persistence unchanged.

Non-goals: new crawler technology, OCR/RAG/embeddings, authentication redesign, schema migration, permanent seed changes, WebSocket/SSE infrastructure, or unbounded crawling.

## Design and stage reuse

Reuse `frontend/app/globals.css` and current page components: system Chinese-capable fonts; ink `#172033`, blue `#275be8`, muted `#687386`, line `#e6eaf0`, white panels; maximum 980px content width, 32px outer allowance, and the existing 640px mobile breakpoint. Preserve search/loading/result/empty/error/progress states. This backend-route fix requires no new design exploration or Figma/Pixso structure. Browser screenshots validate the retained flow; they do not establish original-production visual parity unless compared to that reference.

Product gate: the bounded goal and constraints are defined and user-approved. The current release must still pass implementation tests, responsive screenshot QA, Preview crawling, and production verification. Historical deployment evidence remains separate from this iteration.

## 2026-09-14 crawl-result download closure

The user must be able to see that a library-miss search is actively crawling, and every PDF successfully persisted by those jobs must appear as a library result with preview/download actions. The association is recorded by job and document identity; the search phrase does not overwrite evidence-derived document metadata. Existing crawl limits, source links, SSRF checks, PDF-byte validation, deduplication, and server-only authentication remain in force.

The user-selected workflow above supersedes the older automatic-trigger behavior in the linked search-miss design and frontend implementation plan. Those documents remain historical architecture evidence for the Worker and job-progress contracts.
