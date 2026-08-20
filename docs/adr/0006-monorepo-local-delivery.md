# Monorepo layout and provider-limited local delivery

Status: Accepted; Zendesk provisioning is superseded for this delivery by
ADR 0008.

The codebase is a pnpm-workspaces monorepo with three packages: `server/`
(Fastify, Agent Core, Local Ticket System, simulated Case System, knowledge
retrieval, and eval runner), `web/` (a minimal Vite/React health-page scaffold),
and `shared/` (wire types). PostgreSQL with pgvector runs in Docker Compose.

The accepted handoff is the repository and its reproducible provider-free local
ticket evaluation. `pnpm eval` uses an explicit dedicated evaluation database,
the deterministic evaluator model, versioned policy content, and the local
ticket gateway. It does not provision or call Zendesk, OpenAI, or ElevenLabs.
`pnpm seed` is a separate optional OpenAI-backed developer path for live chat
and local worker experimentation. A Zendesk provisioning command is not
present; that future administrator work remains OTHRM-29.

## Consequences

- The accepted workflow is documented as `pnpm install`, named Compose startup,
  migration of `EVAL_DATABASE_URL`, and `pnpm eval`; see the repository README.
- The `EVAL_DATABASE_URL` and test database are intentionally distinct from the
  normal development database, preventing evaluator fixtures from being
  confused with other local work.
- The `shared/` package is the single source of truth for conversation-event and tool-call types.
- ADR 0008 remains the authority for the Zendesk HTTP 403 limitation and the
  forbidden-claims boundary.
