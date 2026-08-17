# TypeScript everywhere, one app

The entire build is TypeScript: a Node/Fastify server owning HTTP and WebSocket (voice audio), a React/Vite demo UI, and Postgres + Drizzle for the Case System. One language and one process model minimizes cross-language friction for the agentic build-out. Next.js was rejected because its serverless model fights long-lived WebSocket streams; a Python backend was rejected because a two-language build doubles the tooling and test surface.

## Considered Options

- Python (FastAPI) backend + TS frontend — rejected: two languages, two test setups, protocol boundary.
- Next.js full-stack — rejected: awkward host for long-lived voice WebSockets.
