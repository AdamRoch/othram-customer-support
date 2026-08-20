# Othram AI Support Agent

Challenger-project demo for Othram: an AI support agent resolving tickets
through the provider-limited Local Ticket System and escalating only when
necessary. Browser voice is deferred target scope. Spec: PRD.md. Domain
glossary: CONTEXT.md. Decisions: docs/adr/. Real Zendesk integration is future
administrator-owned work tracked by OTHRM-29.

## Agent skills

### Issue tracker

Issues are tracked in the hosted OrbitTrack at https://orbittrack.adamroch.com,
scoped to project `OTHRM`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); `ready-for-agent` is auto-derived by OrbitTrack. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
