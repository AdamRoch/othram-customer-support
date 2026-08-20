# Escalation policy: questions resolve, decisions escalate

Escalation is an explicit tool the Agent Core calls — `escalate(reason, summary, team)` — never an emergent behavior. Triggers (from the project brief): complex issue, outside standard procedures, customer frustrated, billing dispute, technical problem, customer requests human, low self-reported confidence. The canonical boundary tying them together: **questions resolve, decisions escalate**. Facts from the Case System or KB are answered directly; requests for decisions or exceptions go to humans. Note the brief escalates billing *disputes* — billing *questions* (pricing, invoice copies) are resolved like any other fact lookup.

Zendesk mechanics on escalate: internal note with structured summary, assign to the appropriate group (Technical Team / Billing / General Support), tag `ai-escalated` + reason tag, status → open, customer receives a polite acknowledgment. Confidence is self-reported per drafted reply with a tunable threshold — this is the "escalation balance" dial. The initial validated threshold is `0.7`: confidence below `0.7` escalates, while confidence at or above `0.7` may reply.

## Consequences

- Every escalation is a logged, auditable event with a machine-readable reason — feeds directly into the human-avoidance-rate metric.
- The same emotional-state signal used for Emotional Delivery (ADR 0002) drives the "frustrated customer" trigger on both channels.
