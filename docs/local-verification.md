# Local verification evidence

Sanitized clean-checkout-style verification ran on 2026-08-20 against a fresh
named Docker Compose project, an isolated port, and three empty PostgreSQL
databases: one each for runtime, tests, and evaluation. Provider environment
variables were explicitly blank for the run. No `pnpm seed` or vendor smoke
test was run.

The sequence was:

```sh
pnpm install --frozen-lockfile
docker compose -p <isolated-project> up -d --wait
# Create <isolated-project>_runtime, _test, and _eval.
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

This is local Local Ticket System evidence. It is not evidence of Zendesk,
OpenAI, ElevenLabs, voice, webhooks, external timing, or production behavior.
