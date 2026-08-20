# Othram AI Support Agent

This repository packages the accepted **Local Ticket System** support workflow.
It is a durable PostgreSQL implementation behind `TicketGateway`, not a real
Zendesk integration. The provider-free evaluation exercises the workflow with
three deterministic tickets:

1. a requester receives computed facts about their case timeline;
2. a requester receives a cited photo-permission answer; and
3. a DNA mismatch/reprocessing request is escalated to the Technical Team.

The Zendesk OAuth token exchange succeeded, but the authenticated identity
request returned **HTTP 403**. No real Zendesk ticket was created or processed.
The administrator-owned recovery work is OTHRM-29. See
[ADR 0008](docs/adr/0008-local-ticket-system-fallback.md) and the
[sanitized vendor result](docs/vendor-smoke-test.md) for the boundary.

## Current delivery limits

- The implemented ticket workflow is a local PostgreSQL-backed Local Ticket
  System. It does not connect to Zendesk, receive Zendesk webhooks, or validate
  Zendesk ingestion, replies, routing, or setup.
- `pnpm eval` uses deterministic local model and knowledge-search
  implementations. It makes no OpenAI, Zendesk, or ElevenLabs calls; its 2/3
  human-avoidance result is local-eval evidence, not production performance.
- The browser exposes only a server-health page. Voice transport, microphone
  capture, transcription, audio playback, Emotional Delivery, and the operator
  console are deferred and have not been demonstrated.
- `pnpm seed`, live `/api/chat`, and enabled local polling require OpenAI.
  ElevenLabs is not required for the implemented ticket demo.
- No response-time SLA, cloud deployment, real Othram-system integration, or
  provider availability is claimed.

## Quick proof: provider-free local evaluation

Prerequisites: Node.js 20+, pnpm 9+, Docker Desktop, and a running Docker
daemon. The accepted path needs no OpenAI, Zendesk, or ElevenLabs credentials.

From a clean checkout:

```sh
pnpm install --frozen-lockfile
cp .env.example .env

# Use a dedicated Compose project and port so this proof does not share a DB
# with another checkout. The volume is named by this project only.
COMPOSE_PROJECT_NAME=othram_eval_demo POSTGRES_PORT=55432 docker compose up -d --wait

# Create the dedicated evaluator database once. Its name intentionally contains
# "eval"; the evaluator refuses any other database name.
COMPOSE_PROJECT_NAME=othram_eval_demo POSTGRES_PORT=55432 \
  docker compose exec -T db createdb -U othram othram_eval

export EVAL_DATABASE_URL=postgresql://othram:othram@127.0.0.1:55432/othram_eval
DATABASE_URL="$EVAL_DATABASE_URL" pnpm db:migrate
pnpm eval
```

Expected scoreboard:

```text
Local Ticket Evaluation
Zendesk not used
OpenAI not used
PASS case_status (resolved)
PASS photo_permission (resolved)
PASS dna_reprocessing (escalated)
Human avoidance: 2/3 (66.7%) — local eval only; not production performance.
Determinism: PASS (2 identical runs)
```

`pnpm eval` runs the same three scenarios twice against the real local
PostgreSQL workflow. It creates only run-owned fixture tickets, a case, and a
cursor, then removes those fixtures on success or failure. The test suite also
injects failures to verify that cleanup begins even if initialization fails.
The evaluator uses a scripted model and a fixed local knowledge result, so it
does not call either provider. It is evidence for this local workflow only.

When you are finished with this isolated proof, remove only its named Compose
project and volume:

```sh
COMPOSE_PROJECT_NAME=othram_eval_demo POSTGRES_PORT=55432 docker compose down -v
```

## Full local verification

Use an isolated test database in the same Compose instance. The test suite
rejects a URL whose database name does not contain `test`.

```sh
COMPOSE_PROJECT_NAME=othram_eval_demo POSTGRES_PORT=55432 \
  docker compose exec -T db createdb -U othram othram_test
export TEST_DATABASE_URL=postgresql://othram:othram@127.0.0.1:55432/othram_test
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate

pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm eval
```

The migration command is intentionally run once for each named database. It
bootstraps the canonical stage-duration reference data required by the
evaluator. No OpenAI embedding seed is needed for the accepted path.

## Optional live OpenAI development path

This is separate from the accepted provider-free proof. It requires a private
`OPENAI_API_KEY` in `.env`; never commit it or enable shell tracing while
loading it.

```sh
# Start a normal development database (not the eval or test database).
docker compose up -d --wait
pnpm db:migrate
pnpm seed
pnpm dev
```

`pnpm seed` loads the fixed demo customers, cases, stage-duration defaults, and
embeddings for the bundled knowledge documents. It calls OpenAI for embeddings
and fails before seed changes if that request cannot be completed. The server
uses `http://127.0.0.1:3001`; the web development page is at
`http://127.0.0.1:5173`.

With the server running, a live Agent Core chat can be tried with:

```sh
curl -X POST http://127.0.0.1:3001/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"How can you help with my Othram case?"}'
```

Set `LOCAL_TICKET_POLLING_ENABLED=true` only for optional local ticket-worker
development, together with `OPENAI_API_KEY` and a database already seeded with
knowledge embeddings. The worker polls immediately at startup and then every
`LOCAL_TICKET_POLL_INTERVAL_MS` milliseconds (30 seconds by default). It stops
cleanly on the first SIGINT/SIGTERM and force-exits on a second signal.

The polling implementation keeps a durable opaque cursor, leases work per
ticket, persists an agent reply before delivery, and uses idempotency keys for
retries. For a terminal escalation it atomically writes the structured internal
note, team assignment, tags, `open` status, and exactly one public
acknowledgment. Those are Local Ticket System guarantees, not Zendesk results.

## Data and limits

The fixture identities and reference data are documented in
[docs/seed-data.md](docs/seed-data.md). The Local Ticket System is described in
[ADR 0008](docs/adr/0008-local-ticket-system-fallback.md). The exact vendor
smoke-test boundary is in [docs/vendor-smoke-test.md](docs/vendor-smoke-test.md).

The repository’s `docker compose down -v` command removes the database volume
for the selected Compose project. Do not run it against an unnamed/shared
project unless deleting that specific local database is intended.
