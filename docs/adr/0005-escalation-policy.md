# Escalation policy: questions resolve, decisions escalate

Escalation is an explicit tool the Agent Core calls — `escalate(reason, summary, team)` — never an emergent behavior. Triggers (from the project brief): complex issue, outside standard procedures, customer frustrated, billing dispute, technical problem, customer requests human, low self-reported confidence. The canonical boundary tying them together: **questions resolve, decisions escalate**. Facts from the Case System or KB are answered directly; requests for decisions or exceptions go to humans. Note the brief escalates billing *disputes* — billing *questions* (pricing, invoice copies) are resolved like any other fact lookup.

For the provider-limited Local Ticket System, escalation is split into two
durable steps. The polling worker parks the structured reason, summary, and
team as pending work without sending a public reply. OTHRM-17 owns delivery of
the internal note, assignment to the appropriate team (Technical Team /
Billing / General Support), `ai-escalated` and reason tags, open status, and a
polite Customer acknowledgment through `TicketGateway`. Confidence is
self-reported per drafted reply with a tunable threshold — this is the
"escalation balance" dial. The initial validated threshold is `0.7`: confidence
below `0.7` escalates, while confidence at or above `0.7` may reply.

## Consequences

- Every escalation is a logged, auditable event with a machine-readable reason — feeds directly into the human-avoidance-rate metric.
- The same emotional-state signal used for Emotional Delivery (ADR 0002) drives the "frustrated customer" trigger on both channels.
