# Timelines are computed, never generated

The #1 support query is "where is my Case?" and the brief demands zero hallucination about case status. The Case System therefore models a Case as a Stage machine (RECEIVED → … → DELIVERED, with an orthogonal DELAYED flag) plus a StageDuration table of standard days-per-stage. Answers about timeline and ETA are computed from `current_stage`, `stage_entered_at`, and those durations — the Agent Core receives the computed facts via its case-lookup tool and phrases them, but never estimates dates itself.

## Consequences

- The case-lookup tool returns computed timeline facts, not raw rows the LLM could misread.
- Standard durations live as seed data, tunable without code changes.
- Identity rule: a case number alone suffices for status-level answers; anything beyond status requires matching the email on file.
