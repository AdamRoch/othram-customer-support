# TypeScript everywhere, one app

Status: Accepted architecture direction. The current provider-limited build is
TypeScript with a Node/Fastify HTTP server, a minimal React/Vite health-page
scaffold, and Postgres + Drizzle for the Local Ticket and Case Systems. The
WebSocket voice ownership below is historical target architecture, not a
current implementation claim. One language and one process model minimizes
cross-language friction for the agentic build-out. Next.js was rejected because
its serverless model fights long-lived WebSocket streams; a Python backend was
rejected because a two-language build doubles the tooling and test surface.

## Considered Options

- Python (FastAPI) backend + TS frontend — rejected: two languages, two test setups, protocol boundary.
- Next.js full-stack — rejected: awkward host for long-lived voice WebSockets.
