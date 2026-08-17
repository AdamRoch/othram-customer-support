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

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
