# Othram AI Support Agent

Local demo for an AI support agent that handles Zendesk Tickets and browser
voice conversations, escalating decisions to a human when needed.

## Prerequisites

- Node.js 20+
- pnpm 9+

Copy `.env.example` to `.env` after completing the human-owned setup in
[`INFRA-SETUP.md`](INFRA-SETUP.md). The health endpoint works without vendor
credentials. The Agent Core and knowledge seed require `OPENAI_API_KEY`.

## Run locally

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The page calls `GET http://localhost:3001/health`
and displays the server result.

## Agent Core

Start PostgreSQL as described below, set `OPENAI_API_KEY` in `.env`, then start
the app with `pnpm dev`. Start a conversation by posting a non-empty message:

```sh
curl -X POST http://localhost:3001/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"How can you help with my Othram Case?"}'
```

The response includes a `conversationId`. Send it with a later message to
continue the same in-memory conversation:

```sh
curl -X POST http://localhost:3001/api/chat \
  -H 'content-type: application/json' \
  -d '{"conversationId":"<conversation-id>","message":"One more question"}'
```

Policy and process replies are grounded in retrieved knowledge passages and
include a source citation. Each completed turn also returns typed events for
the Customer emotional-state read and any escalation. When the Agent Core
escalates without sending a Customer-facing message, `reply` is `null`.

The optional model override is documented in [`.env.example`](.env.example).

## Database

The local database is PostgreSQL 16 with the `pgvector` extension. Start it
before starting the server:

```sh
docker compose up -d
pnpm db:migrate
```

The default connection string is set in [`.env.example`](.env.example). Copy it
to `.env` or export `DATABASE_URL` to use a different database. The server
checks this connection during boot and exits with an actionable error if it is
unavailable.

To confirm pgvector is enabled or reset the local database:

```sh
docker compose exec db psql -U othram -d othram -c 'SELECT extname FROM pg_extension WHERE extname = '\''vector'\'';'
docker compose down -v
```

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
