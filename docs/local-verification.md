# Local verification evidence

Sanitized clean-checkout-style verification ran on 2026-08-20 against a fresh
named Docker Compose project, an isolated port, and three empty PostgreSQL
databases: one each for runtime, tests, and evaluation. Provider environment
variables were explicitly blank for the run. No `pnpm seed` or vendor smoke
test was run.

The sequence generated one unique `COMPOSE_PROJECT_NAME`, selected a free
`POSTGRES_PORT`, then used `docker compose -p "$COMPOSE_PROJECT_NAME"` for
every Compose action. It explicitly blanked all provider variables so a local
`.env` could not supply credentials. The names `<project>_runtime`,
`<project>_test`, and `<project>_eval` were created idempotently and migrated
before use; the proof ended with scoped `docker compose -p "$COMPOSE_PROJECT_NAME"
down -v --remove-orphans` cleanup.

The sequence was:

```sh
pnpm install --frozen-lockfile
export OPENAI_API_KEY= ELEVENLABS_API_KEY= ELEVENLABS_VOICE_ID=
export ZENDESK_SUBDOMAIN= ZENDESK_CLIENT_ID= ZENDESK_CLIENT_SECRET=
docker compose -p <isolated-project> up -d --wait
# Idempotently create and migrate <isolated-project>_runtime, _test, and _eval.
DATABASE_URL=<runtime-url> pnpm db:migrate
DATABASE_URL=<test-url> pnpm db:migrate
DATABASE_URL=<eval-url> pnpm db:migrate
EVAL_DATABASE_URL=<eval-url> pnpm eval
LOCAL_TICKET_POLLING_ENABLED=false DATABASE_URL=<runtime-url> \
  pnpm --filter @othram/server dev
curl --fail http://127.0.0.1:3001/health
TEST_DATABASE_URL=<test-url> EVAL_DATABASE_URL=<eval-url> pnpm typecheck
TEST_DATABASE_URL=<test-url> EVAL_DATABASE_URL=<eval-url> pnpm lint
TEST_DATABASE_URL=<test-url> EVAL_DATABASE_URL=<eval-url> pnpm test
TEST_DATABASE_URL=<test-url> EVAL_DATABASE_URL=<eval-url> pnpm build
```

Results:

- Migrations applied successfully to all three empty databases.
- `pnpm eval` printed all three scenario passes and `Determinism: PASS (2 identical runs)`.
- The server health endpoint returned `{"status":"ok","service":"othram-support-server"}`.
- Typecheck, lint, production build, and the real-PostgreSQL test run passed:
  19 test files and 107 tests.

The full suite includes focused durable-work evidence for the restart-safe
cursor and idempotent crash/retry effects. Re-run those checks against the
dedicated test database with:

```sh
TEST_DATABASE_URL=<test-url> pnpm --filter @othram/server test -- \
  -t 'persists a cursor and does not enqueue overlap again after restart'
TEST_DATABASE_URL=<test-url> pnpm --filter @othram/server test -- \
  -t 'retries the delivery crash window with one public reply'
TEST_DATABASE_URL=<test-url> pnpm --filter @othram/server test -- \
  -t 'captures only public context through the inbound message and retries an escalation crash without duplicates'
```

This is local Local Ticket System evidence. It is not evidence of Zendesk,
OpenAI, ElevenLabs, voice, webhooks, external timing, or production behavior.
