# Monorepo layout, local-only delivery

Status: Accepted; the Zendesk provisioning requirement is superseded for the
provider-limited delivery by ADR 0008

The codebase is a pnpm-workspaces monorepo with three packages: `server/` (Fastify — Agent Core, Ticket and Voice channel adapters, Case System, KB retrieval, eval runner), `web/` (Vite/React — voice demo page and operator console), and `shared/` (types shared across the wire). Postgres + pgvector run in docker-compose; `pnpm seed` loads all seed data and `pnpm zendesk:setup` provisions groups/tags/macros in the trial Zendesk instance via API.

Delivery is the repo plus a filmed demo — **no cloud deployment**. A live deploy would require shipping Zendesk credentials and a tunnel for zero grading benefit; the film plus a reproducible local setup is the stronger deliverable.

## Consequences

- Everything a reviewer needs runs with `docker compose up`, `pnpm seed`, `pnpm dev`.
- The `shared/` package is the single source of truth for conversation-event and tool-call types.
