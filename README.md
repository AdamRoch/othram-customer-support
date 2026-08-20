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

# Explicitly override any existing .env provider values. The accepted proof
# must not call OpenAI, Zendesk, or ElevenLabs.
export OPENAI_API_KEY= ELEVENLABS_API_KEY= ELEVENLABS_VOICE_ID=
export ZENDESK_SUBDOMAIN= ZENDESK_CLIENT_ID= ZENDESK_CLIENT_SECRET=

# Generate an isolated Compose project and choose an unused local port once.
# Keep these exports in this shell for every command below.
export COMPOSE_PROJECT_NAME="othram_eval_${RANDOM}_${RANDOM}"
export POSTGRES_PORT=55432
while nc -z 127.0.0.1 "$POSTGRES_PORT" >/dev/null 2>&1; do
  export POSTGRES_PORT=$((POSTGRES_PORT + 1))
done

export RUNTIME_DATABASE_URL="postgresql://othram:othram@127.0.0.1:${POSTGRES_PORT}/${COMPOSE_PROJECT_NAME}_runtime"
export TEST_DATABASE_URL="postgresql://othram:othram@127.0.0.1:${POSTGRES_PORT}/${COMPOSE_PROJECT_NAME}_test"
export EVAL_DATABASE_URL="postgresql://othram:othram@127.0.0.1:${POSTGRES_PORT}/${COMPOSE_PROJECT_NAME}_eval"

docker compose -p "$COMPOSE_PROJECT_NAME" up -d --wait

# Idempotently create exactly the three databases owned by this proof.
ensure_database() {
  docker compose -p "$COMPOSE_PROJECT_NAME" exec -T db \
    psql -v ON_ERROR_STOP=1 -U othram -d postgres -v db_name="$1" <<'SQL'
SELECT format('CREATE DATABASE %I', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')
\gexec
SQL
}
ensure_database "${COMPOSE_PROJECT_NAME}_runtime"
ensure_database "${COMPOSE_PROJECT_NAME}_test"
ensure_database "${COMPOSE_PROJECT_NAME}_eval"

# Migration 0005 supplies canonical stage-duration reference data to each DB.
DATABASE_URL="$RUNTIME_DATABASE_URL" pnpm db:migrate
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate
DATABASE_URL="$EVAL_DATABASE_URL" pnpm db:migrate
EVAL_DATABASE_URL="$EVAL_DATABASE_URL" pnpm eval
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

The script has created a runtime database too, so the server can be checked
without an OpenAI key. In a second terminal using the same exports, run:

```sh
OPENAI_API_KEY= ELEVENLABS_API_KEY= LOCAL_TICKET_POLLING_ENABLED=false \
DATABASE_URL="$RUNTIME_DATABASE_URL" \
pnpm --filter @othram/server dev
```

Then, from the first terminal:

```sh
curl --fail http://127.0.0.1:3001/health
```

Stop the server with Ctrl-C. The server proof explicitly leaves polling off and
therefore does not call OpenAI.

## Full local verification

Continue in the shell from the quick proof. The dedicated database names above
already satisfy the evaluator `eval` and test-suite `test` isolation checks.

```sh
TEST_DATABASE_URL="$TEST_DATABASE_URL" EVAL_DATABASE_URL="$EVAL_DATABASE_URL" pnpm typecheck
TEST_DATABASE_URL="$TEST_DATABASE_URL" EVAL_DATABASE_URL="$EVAL_DATABASE_URL" pnpm lint
TEST_DATABASE_URL="$TEST_DATABASE_URL" EVAL_DATABASE_URL="$EVAL_DATABASE_URL" pnpm test
TEST_DATABASE_URL="$TEST_DATABASE_URL" EVAL_DATABASE_URL="$EVAL_DATABASE_URL" pnpm build
EVAL_DATABASE_URL="$EVAL_DATABASE_URL" pnpm eval
```

The migration command is intentionally run once for each named database. It
bootstraps the canonical stage-duration reference data required by the
evaluator. No OpenAI embedding seed is needed for the accepted path.

When you are finished, delete only this shell’s generated Compose project and
volume:

```sh
docker compose -p "$COMPOSE_PROJECT_NAME" down -v --remove-orphans
```

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

Copy-paste invocation for that optional live polling path (replace the key and
database URL; this is not part of `pnpm eval`):

```sh
OPENAI_API_KEY='<private-key>' \
DATABASE_URL='postgresql://othram:othram@127.0.0.1:5432/othram' \
LOCAL_TICKET_POLLING_ENABLED=true \
LOCAL_TICKET_POLL_INTERVAL_MS=30000 \
pnpm --filter @othram/server dev
```

The polling implementation keeps a durable opaque cursor, leases work per
ticket, persists an agent reply before delivery, and uses idempotency keys for
retries. For a terminal escalation it atomically writes the structured internal
note, team assignment, tags, `open` status, and exactly one public
acknowledgment. Those are Local Ticket System guarantees, not Zendesk results.

The focused real-PostgreSQL tests behind the restart and retry claims can be
run against the dedicated `TEST_DATABASE_URL` from the verification section:

```sh
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @othram/server test -- \
  -t 'persists a cursor and does not enqueue overlap again after restart'
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @othram/server test -- \
  -t 'retries the delivery crash window with one public reply'
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @othram/server test -- \
  -t 'captures only public context through the inbound message and retries an escalation crash without duplicates'
```

## Data and limits

The fixture identities and reference data are documented in
[docs/seed-data.md](docs/seed-data.md). The Local Ticket System is described in
[ADR 0008](docs/adr/0008-local-ticket-system-fallback.md). The exact vendor
smoke-test boundary is in [docs/vendor-smoke-test.md](docs/vendor-smoke-test.md).

The repository’s `docker compose down -v` command removes the database volume
for the selected Compose project. Do not run it against an unnamed/shared
project unless deleting that specific local database is intended.
