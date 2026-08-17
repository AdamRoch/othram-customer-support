# Issue Tracker — OrbitTrack

Issues live in **OrbitTrack**, a local tracker at http://localhost:3000, under
project **`OTHRM`** (identifier prefix `OTHRM-N`). All routes are JSON in/out.
The server must be running (`npm run dev` in the OrbitTrack repo) before any call.

## Project scope — always

Every `/api/issues/*` call for this repo MUST include `?project=OTHRM`.
Without it, requests silently hit the *default* project (first by id) —
tickets will land in the wrong project.

## Standard workflow

1. **Check the frontier** — grabbable work (todo + unblocked):
   `curl 'localhost:3000/api/issues/frontier?project=OTHRM'`
2. **Claim**: `curl -X POST localhost:3000/api/issues/OTHRM-42/claim`
   (atomically `todo` → `in_progress`; 409 if not claimable)
3. **Do the work.**
4. **Done**: `curl -X PATCH localhost:3000/api/issues/OTHRM-42?project=OTHRM
   -H 'content-type: application/json' -d '{"status":"done"}'`

## Creating tickets

```bash
curl -X POST 'localhost:3000/api/issues?project=OTHRM' \
  -H 'content-type: application/json' \
  -d '{"title":"...","description":"...","status":"todo","priority":2,"labelNames":["needs-triage"]}'
```

- `status`: `todo` (committable work), `backlog` (captured, not committed; never on the frontier)
- `priority`: 1 (highest) – 4 (lowest)
- `labelNames` must already exist (labels are global across projects).
  Apply/replace later via `PUT /api/issues/OTHRM-N/labels?project=OTHRM`.

## Blockers

`POST /api/issues/OTHRM-N/blockers {"blockerId": <id or "OTHRM-M">}` creates
"A blocks B"; the graph is a DAG (cycles rejected). A blocked issue leaves the
frontier until its blockers are `done`.
