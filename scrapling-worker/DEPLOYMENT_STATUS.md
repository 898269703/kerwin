# Scrapling deployment status

Updated: 2026-09-08

## Current branch state

- Repository: `898269703/kerwin`
- Branch: `crawler-mvp`
- Long-term crawler engine: Scrapling
- Service root: `scrapling-worker`
- Health endpoint: `/health`
- Target port: `3001`

## Railway checkpoint

- Project: `pdf-finder-search`
- Environment: `production`
- Current service slot: `crawler-worker` (temporarily used as the Scrapling green slot because the Railway Free plan has reached its service provisioning limit)
- PostgreSQL remains unchanged.
- No Vercel cutover should happen until the Scrapling build, health check, and production acceptance corpus pass.
- The legacy `crawler-worker/` source remains in the repository as the rollback code path.

## Latest verification focus

The branch now contains the implementation for extensionless/external PDF candidate classification added after the failing tests introduced in commit `328e0cbe75d113cd42ba7d1df363a1cb834f56ac`.

This checkpoint commit intentionally touches `scrapling-worker/**` so Railway rebuilds from the current branch HEAD instead of replaying the stale failing snapshot.
