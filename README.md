# Othram AI Support Agent

Local demo for an AI support agent that handles Zendesk Tickets and browser
voice conversations, escalating decisions to a human when needed.

## Prerequisites

- Node.js 20+
- pnpm 9+

Copy `.env.example` to `.env` only after completing the human-owned setup in
[`INFRA-SETUP.md`](INFRA-SETUP.md). No vendor credentials are needed to run this
scaffold.

## Run locally

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The page calls `GET http://localhost:3001/health`
and displays the server result.

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
