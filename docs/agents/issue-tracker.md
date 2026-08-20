# Issue Tracker — OrbitTrack

Issues live in the hosted **OrbitTrack** at https://orbittrack.adamroch.com,
under project **`OTHRM`** (identifier prefix `OTHRM-N`). The hosted tracker is
authoritative; do not update a local OrbitTrack instance for this project. All
routes are JSON in/out and require `Authorization: Bearer
$ORBITTRACK_AGENT_TOKEN`.

## Project scope — always

Every `/api/issues/*` call for this repo MUST include `?project=OTHRM`.
Without it, requests silently hit the *default* project (first by id) —
tickets will land in the wrong project.

## Standard workflow

1. **Check the frontier** — grabbable work (todo + unblocked):
   `curl -H "Authorization: Bearer $ORBITTRACK_AGENT_TOKEN" 'https://orbittrack.adamroch.com/api/issues/frontier?project=OTHRM'`
2. **Claim**: `curl -X POST -H "Authorization: Bearer $ORBITTRACK_AGENT_TOKEN" 'https://orbittrack.adamroch.com/api/issues/OTHRM-42/claim?project=OTHRM'`
   (atomically `todo` → `in_progress`; 409 if not claimable)
3. **Do the work.**
4. **Done**: `curl -X PATCH 'https://orbittrack.adamroch.com/api/issues/OTHRM-42?project=OTHRM'
   -H "Authorization: Bearer $ORBITTRACK_AGENT_TOKEN"
   -H 'content-type: application/json' -d '{"status":"done"}'`

## Creating tickets

```bash
curl -X POST 'https://orbittrack.adamroch.com/api/issues?project=OTHRM' \
  -H "Authorization: Bearer $ORBITTRACK_AGENT_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"...","description":"...","status":"todo","priority":2,"labelNames":["needs-triage"]}'
```

- `status`: `todo` (committable work), `backlog` (captured, not committed; never on the frontier)
- `priority`: 1 (highest) – 4 (lowest)
- `labelNames` must already exist (labels are global across projects).
  Apply/replace later via `PUT /api/issues/OTHRM-N/labels?project=OTHRM`.

## Blockers

`POST /api/issues/OTHRM-N/blockers?project=OTHRM {"blockerId": <id or "OTHRM-M">}` creates
"A blocks B"; the graph is a DAG (cycles rejected). A blocked issue leaves the
frontier until its blockers are `done`.
