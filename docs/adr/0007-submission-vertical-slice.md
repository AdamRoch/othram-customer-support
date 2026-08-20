# Submit a Zendesk-first vertical slice

Status: Accepted for the initial submission

## Context

The approved full-product PRD adds a browser voice channel, Emotional Delivery,
an operator console, webhook ingestion, and a thirteen-scenario evaluation suite
to the original challenger brief. At the time of this decision, the repository
had completed the Case System, computed timelines, knowledge ingestion,
embeddings, and cited search, but did not yet contain the Agent Core or either
complete channel.

The immediate objective is a credible submission that proves the original
brief's central claim through a real Zendesk instance. The full design remains
the product direction and can be resumed after submission.

## Decision

The initial submission will implement one production-shaped Zendesk vertical
slice using the existing shared architecture:

1. A real Zendesk ticket enters through polling.
2. The shared Agent Core classifies the request and invokes explicit tools.
3. `lookup_case` returns computed status and timeline facts from PostgreSQL.
4. `search_knowledge` returns grounded passages with citations.
5. Straightforward questions receive a public reply and are marked solved.
6. A technical mismatch request invokes `escalate`, adds a structured internal
   note, routes the ticket to the Technical Team, tags it, and acknowledges the
   customer.

The submission demonstration will prove three scenarios end to end:

- A case-status question resolves from computed Case System facts.
- A photo-permission question resolves from a cited knowledge passage.
- A DNA mismatch or reprocessing request escalates with the correct Zendesk
  routing and context.

The Agent Core and Zendesk client remain reusable foundations for the full
version. Implementations should retain the existing interfaces and event types,
but should not add behavior solely for deferred UI or voice consumers.

## Submission acceptance boundary

The slice is ready to submit when:

- OpenAI tool calling and Zendesk authenticated ticket create/read checks pass.
- The three scenarios above pass against the seeded database and real Zendesk.
- Re-running the demonstration does not duplicate replies or lose the polling
  cursor.
- Lint, type-check, tests, and production build pass.
- The README contains exact setup and demonstration commands.
- No credential, access token, customer data, or generated provider artifact is
  committed or printed in retained evidence.

ElevenLabs Scribe already has positive feasibility evidence, but ElevenLabs v3
TTS is not a submission gate for this slice. Its incompatible configured voice
remains tracked for the full voice version.

## Deferred until after submission

- Webhook ingestion
- Browser voice transport, realtime Scribe integration, and audio playback
- Emotional Delivery and ElevenLabs v3 TTS
- Voice transcript UI and barge-in
- Operator console
- Full ticket and voice scenario suites
- Full human-avoidance scoreboard and filmed voice demo

## Consequences

- The submission directly satisfies the source brief's Zendesk integration,
  grounded information access, autonomous resolution, escalation judgment, and
  proper Zendesk API use.
- The submission does not satisfy the full PRD's voice-specific acceptance
  criteria and must be described as a focused vertical slice, not the completed
  full product.
- The issue graph must stop treating ElevenLabs v3 as a blocker for the Agent
  Core and Zendesk work. Voice tickets should continue to depend on the
  ElevenLabs follow-up when the full version resumes.
- Deferred tickets remain in OrbitTrack rather than being canceled, preserving
  the path to the full version.
