# PDF Finder product contract

Updated: 2026-09-12. This is a concise index of the existing product and the current bounded continuation, not a new architecture proposal.

## Product and users

Help people find public technical PDFs by document title, number, or topic; prioritize the owned PDF library and visible source provenance, then discover public web candidates. A verified library result should open or download actual persisted PDF bytes through the application's own route. Public search users do not need crawler management credentials; authorized operators manage seeds and jobs through protected worker APIs.

## Existing contract reused

- [Search-miss automatic crawl design](docs/superpowers/specs/2026-09-08-search-miss-auto-crawl-design.md): library-first search, bounded background discovery, progress, refreshed library results, failures, and Preview gates.
- [Scrapling V3 design](docs/superpowers/specs/2026-09-08-scrapling-v3-design.md): crawling, validation, source provenance, SHA256 identity, PostgreSQL durability, compatibility, and rollback.
- [Frontend implementation plan](docs/superpowers/plans/2026-09-08-pdf-finder-frontend-auto-crawl-implementation.md) and [worker discovery plan](docs/superpowers/plans/2026-09-08-search-discovery-worker-implementation.md) describe the existing feature scope.
- [SDD handoff](docs/superpowers/CODEX_SDD_HANDOFF.md) records V3 approval. The specifications retain their earlier proposal/review headers. These documents describe intended/approved scope; their checklist text is not current test evidence.

## Current iteration

Fix the frontend PDF file proxy's inconsistent credential handling: an OIDC-configured Vercel environment that can call crawler jobs must also be able to fetch a known library PDF. Preserve explicit crawler base/token overrides and the existing server-client fallback behavior. Verify tests/build and the Preview user path, including PDF bytes and desktop/mobile screenshots. [ACCEPTANCE.md](ACCEPTANCE.md) owns the evidence checklist.

Constraints: keep source-visible search and existing Chinese UI; keep bearer/OIDC credentials server-only; preserve authenticated `/v1/*` routes, safe filenames, inline/download semantics, and error responses; keep PostgreSQL data and existing document identity unchanged.

Non-goals: redesign, new crawler technology, OCR/RAG/embeddings, authentication redesign, schema migration, permanent seed changes, broad crawling, production alias cutover, or retirement of rollback infrastructure.

## Design and stage reuse

Reuse `frontend/app/globals.css` and current page components: system Chinese-capable fonts; ink `#172033`, blue `#275be8`, muted `#687386`, line `#e6eaf0`, white panels; maximum 980px content width, 32px outer allowance, and the existing 640px mobile breakpoint. Preserve search/loading/result/empty/error/progress states. This backend-route fix requires no new design exploration or Figma/Pixso structure. Browser screenshots validate the retained flow; they do not establish original-production visual parity unless compared to that reference.

Product gate: the bounded goal and constraints are defined; implementation/verification can proceed. Current risks are credential availability/worker OIDC trust and the need for real Preview download evidence. Historical deployment evidence remains separate from this iteration.
