# PDF Finder Scrapling Worker

Python/Scrapling replacement for the legacy Crawlee worker.

- Primary crawler: Scrapling 0.4.15
- Runtime: Python 3.12 + FastAPI
- Storage: PostgreSQL document catalog + BYTEA blob persistence, with `/data` filesystem cache
- Compatibility: preserves the existing `/health`, `/public/*`, and `/v1/*` HTTP contract

Production cutover is gated by GitHub CI and Railway health checks.
