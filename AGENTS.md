# Othram AI Support Agent

Challenger-project demo for Othram: an AI support agent resolving tickets
(via a real Zendesk trial instance) and browser voice conversations,
escalating only when necessary. Spec: PRD.md. Domain glossary: CONTEXT.md. Decisions: docs/adr/.

## Agent skills

### Issue tracker

Issues are tracked in OrbitTrack (local tracker at http://localhost:3000), scoped to project `OTHRM`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); `ready-for-agent` is auto-derived by OrbitTrack. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
