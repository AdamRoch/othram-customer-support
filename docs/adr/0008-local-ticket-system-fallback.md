# Local Ticket System for provider-limited delivery

Status: Accepted

## Context

ADR 0001 and ADR 0007 require a real Zendesk trial integration for this demo.
The approved vendor smoke test reached the Zendesk OAuth token endpoint and
successfully minted an access token. The subsequent Ticketing identity request
returned HTTP 403. There is no browser or admin access available to correct the
trial configuration, and the smoke test did not create a ticket.

That leaves the real Zendesk integration unresolved. It must not prevent the
rest of the local delivery from being built, exercised, and evaluated.

## Decision

For this provider-limited delivery, the ticket channel will depend on a narrow
`TicketGateway` port. The local implementation is the **Local Ticket System**:
a durable PostgreSQL-backed ticket service that supports cursor reads,
requester and thread retrieval, public replies, internal notes, tags, team
assignment, status changes, and idempotent processing.

Local polling and ticket evals use the Local Ticket System through this port.
A future Zendesk adapter may implement the same port after the provider access
issue is resolved. The Agent Core and ticket workflow must not depend on
Zendesk-specific types outside that adapter.

This ADR supersedes the real-Zendesk requirement in ADR 0001 and ADR 0007
only for this provider-limited delivery. It does not replace the long-term
Zendesk integration decision, and it does not resolve the Zendesk trial issue.

## Consequences

- The ticket vertical can be demonstrated locally with durable state and
  repeatable evals while preserving an adapter boundary for Zendesk.
- Restart-safe cursor handling and idempotency remain acceptance requirements;
  an in-memory substitute is not sufficient.
- Ticket behaviors are validated against the Local Ticket System, not against
  Zendesk APIs or Zendesk's agent workspace.
- The future Zendesk adapter must be validated with authenticated identity,
  ticket create/read, and the required ticket actions before any claim of real
  Zendesk support is restored.

## Forbidden claims

- Do not call the Local Ticket System Zendesk, a Zendesk sandbox, or a mock
  Zendesk.
- Do not claim real Zendesk ticket ingestion, replies, routing, setup, or
  end-to-end validation.
- Do not say that the Zendesk trial is configured or accessible.
- Do not present local ticket eval results as proof of Zendesk API behavior.
