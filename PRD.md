# PRD — Othram AI Support Agent

- Version: 1.0
- Status: Approved (design complete via structured grilling session)
- Source brief: `othram-csa-project.md`
- Domain glossary: `CONTEXT.md` · Decisions: `docs/adr/0001–0008`

## 1. Overview

An AI-powered customer support agent for Othram (forensic genomics), built as a
challenger-project demo. The agent resolves customer inquiries autonomously
across two channels — **Local Ticket System Tickets** and a **browser voice interface** —
and escalates to humans only when necessary.

ADR 0008 updates the current delivery boundary because the Zendesk trial cannot
perform Ticketing operations. The original real-Zendesk design remains the
future target, but current ticket behavior and evidence come only from the
provider-neutral `TicketGateway` and its durable PostgreSQL implementation.

The killer feature is **Emotional Delivery** on the voice channel: the agent
modulates its spoken voice in response to the customer's emotional state —
quieter and calmer when the customer is angry, a slight chuckle when the
customer makes a joke — as a *designed, directed behavior*, not an emergent one.

The primary metric is **human avoidance rate**: the percentage of inquiries
resolved without escalation.

## 2. Goals and success metrics

| Metric | Target |
|---|---|
| Human avoidance rate | Maximized across the eval scenario suite (§9) |
| Response accuracy | Zero hallucinated case facts or policy claims — enforced by construction (§5.4, §6.3) |
| Ticket response time | Under 5 minutes from ticket creation |
| Escalation judgment | Every escalation carries an explicit, logged reason from the trigger list (§7) |
| Demo quality | Filmable voice demo showing Emotional Delivery visibly working |

## 3. Scope

**In scope:**
- Durable Local Ticket System behind the provider-neutral `TicketGateway` (ADR 0008)
- Simulated Case System (local, seeded, behind an interface)
- Browser voice channel with Emotional Delivery
- Knowledge base with grounded (cited) answers
- Atomic, crash-safe Local Ticket System escalation execution
- In-repo eval scenario runner with scoreboard
- Voice demo page + operator console

**Explicitly out of scope (non-goals):**
- No telephony / phone numbers (voice is browser-based; ADR 0002, CONTEXT.md "Voice Channel")
- No cloud deployment — deliverable is the repo plus a filmed demo (ADR 0006)
- No custom ticket UI in the current delivery
- No claim of real Zendesk behavior until provider access is validated
- No integration with Othram's real systems
- No real authentication — lightweight identity rules only (§5.5)

## 4. Architecture

**One Agent Core, two channel adapters** (ADR 0002). All reasoning, tool use,
escalation policy, and emotional judgment live in the shared core. Adapters
translate I/O only.

```
                 ┌──────────────────────────────────────┐
 Local Ticket ─►│ Ticket adapter (cursor polling)      │──┐
                 └──────────────────────────────────────┘  │
                                                           ▼
                 ┌──────────────────────────────────────┐  ┌─────────────┐
 Browser ◄─────► │ Voice adapter (WebSocket audio)      │─►│ Agent Core  │
                 └──────────────────────────────────────┘  │ (OpenAI,    │
                                                           │  tool loop) │
                                                           └──────┬──────┘
                                                                  │
                          ┌───────────────┬───────────────────────┼────────────┐
                          ▼               ▼                       ▼            ▼
                    lookup_case    search_knowledge           escalate      reply
                          │               │                       │
                    ┌───────────┐  ┌──────────────┐        ┌─────────────┐
                    │ Case      │  │ Knowledge    │        │ Ticket      │
                    │ System    │  │ Base         │        │ actions     │
                    │ (Postgres)│  │ (pgvector)   │        │ via gateway │
                    └───────────┘  └──────────────┘        └─────────────┘
```

**Vendors (two total):**
- **OpenAI** — Agent Core model (GPT-class, tool calling) + `text-embedding-3-small` for KB embeddings
- **ElevenLabs** — Scribe realtime STT + TTS (v3 model, inline audio tags)

**Stack:** TypeScript only (ADR 0003). Node/Fastify server (HTTP + WebSocket),
React/Vite web app, Postgres + pgvector in docker-compose, Drizzle ORM,
pnpm workspaces.

## 5. Components

### 5.1 Agent Core (`server/src/agent-core/`)

- Hand-rolled tool-calling loop around the OpenAI SDK — a single legible module,
  no agent framework (ADR 0002 discussion).
- Tools: `lookup_case`, `search_knowledge`, `reply`, `escalate`.
- Per reply, the core also emits: a **confidence score** (self-reported, drives
  the escalation threshold) and a **customer emotional-state read** (drives both
  the "frustrated customer" escalation trigger and Emotional Delivery).
- On the voice channel, the core annotates reply text with inline ElevenLabs v3
  audio tags (`[calm]`, `[whispers]`, `[chuckles]`) selected from the emotional
  read — this is the Emotional Delivery mechanism.
- Emits a structured event stream (tool calls, citations, confidence, emotion,
  escalations) consumed by the operator console and the eval runner. Event and
  tool-call types live in `shared/`.

### 5.2 Ticket channel adapter (`server/src/channels/ticket/`)

- **Provider boundary:** ticket workflows depend on `TicketGateway`. The current
  adapter is the durable PostgreSQL Local Ticket System; Zendesk is a future
  adapter after provider access is validated.
- **Ingestion:** reads public requester comments through a restart-safe opaque
  provider cursor. Concurrent polls advance only from the durable checkpoint;
  Agent replies and internal notes never enter the requester stream.
- **Customer identity:** binds `lookup_case` server-side to the requester email
  stored on the Ticket; the model cannot supply or replace that identity.
- **Actions:** post public reply, post internal note, add normalized lowercase
  tags, assign an exact supported team, and set an exact supported status.
- **Retry contract:** mutations to an existing Ticket require a per-Ticket
  idempotency key. The same operation and input replay the original result;
  reusing the key with different input fails.
- Rebuilds Agent Core context on every attempt from the durable public Ticket
  history before the inbound comment; private notes and process memory are not
  conversation history.
- Persists model output before delivery, then posts the public reply and solves
  the Ticket with stable idempotency keys. Durable leases and retryable work
  states cover concurrent workers, expiry, restart, and the delivery crash
  window without duplicate visible replies.
- Weights each retry attempt as 100 queue slots so a poison item cannot
  monopolize the queue and sustained fresh traffic cannot starve retryable
  work. Work on the same Ticket remains ordered.
- Persists the escalation decision and public context through the triggering
  requester comment before execution. The verified-context, atomic handoff,
  retry, and terminal-state contract is specified in §6.4.

### 5.3 Voice channel adapter (`server/src/channels/voice/`)

- WebSocket endpoint: browser mic audio in, agent audio out.
- Pipeline: ElevenLabs Scribe realtime STT → Agent Core → annotated reply text →
  ElevenLabs TTS → audio stream to browser (ADR 0002).
- Handles turn-taking (end-of-speech detection from the STT stream) and barge-in
  (customer interrupts → stop playback).
- STT and TTS each sit behind small interfaces so vendors are swappable without
  touching the core.

### 5.4 Case System (`server/src/case-system/`)

Simulated system of record (ADR 0001), Postgres + Drizzle:

- **Customer**: `id`, `name`, `email`, `phone`.
- **Case**: `id`, `case_number` (e.g. `OTH-2024-0142`), `customer_id`,
  `service_type` (e.g. *DNASolves® identification*, *kinship testing*),
  `current_stage`, `stage_entered_at`, `submitted_at`, `delayed` (boolean),
  `notes`.
- **StageDuration**: standard expected days per stage — data, not code.

Stages (CONTEXT.md): `RECEIVED → EXTRACTION → QUANTIFICATION → LIBRARY_PREP →
SEQUENCING → BIOINFORMATICS → REVIEW → DELIVERED`; `DELAYED` is orthogonal.

**Timelines are computed, never generated** (ADR 0004): `lookup_case` returns
computed facts (current stage, time in stage, ETA from standard durations), and
the agent phrases them. The LLM never estimates dates.

**Identity rules:** ticket inquiries resolve the Customer by requester email;
voice callers state a case number. A case number alone suffices for
status-level answers; anything beyond status requires the email on file.

### 5.5 Knowledge Base (`server/src/knowledge/`)

- ~15–20 curated Markdown documents modeled on Othram's public material:
  service descriptions, evidence-submission SOP, packaging/shipping
  requirements, media-permission policy (always grant, per the brief),
  chain-of-custody/privacy FAQ, process overviews, pricing basics.
- Chunked and embedded at seed time into **pgvector** (same Postgres, no new
  infrastructure) with `text-embedding-3-small`.
- `search_knowledge` returns passages *with source citations*.
- **Grounding rule:** policy/process answers must come from retrieved passages;
  the reply carries the citation (e.g. "Media Permission Policy §1").

### 5.6 Demo UI (`web/`)

Two pages in one Vite/React app:

- **Voice page:** push-to-talk mic, live two-sided transcript, audio playback,
  and a visible emotion/delivery readout ("customer: frustrated → responding
  calm/quiet") that makes Emotional Delivery filmable.
- **Operator console:** read-only live stream of agent events per conversation —
  tool calls, KB citations, confidence scores, escalation events with reasons.

Ticket-side UI: none in the current provider-limited delivery.

### 5.7 Eval runner (`server/src/eval/`)

- `pnpm eval` runs scripted conversations against the real Agent Core with the
  seeded Case System, asserts outcomes, prints a scoreboard headlined by human
  avoidance rate.
- Scenario suite in §9 is the acceptance bar.

## 6. Behavioral policy

### 6.1 The boundary rule

**Questions resolve, decisions escalate** (ADR 0005). Facts from the Case
System or KB are answered directly; anything asking Othram to decide or make an
exception (refunds, reprocessing, policy exceptions, disputes) escalates.
Billing *questions* resolve; billing *disputes* escalate.

### 6.2 Escalation triggers

Complex issue · outside standard procedures · customer frustrated · billing
dispute · technical problem · customer requests human · low self-reported
confidence (below a single tunable threshold — the "escalation balance" dial).

### 6.3 Guardrails (prompt + capability level)

- **Scope:** the core's system prompt defines scope (cases + Othram services)
  with the brief's redirect pattern; enforcement is structural — the agent has
  no tools with which to do off-topic work.
- **Honesty:** `lookup_case` has an explicit `not_found` state; the agent says
  it can't locate the case and offers a specialist. It cannot state a case fact
  the database didn't return, because the database is its only source.
- **Untrusted input:** customer text is data, not instructions; embedded
  instructions in tickets/transcripts are ignored.

### 6.4 Escalation mechanics

The polling channel first durably parks `escalate(reason, summary, team)` with
the turn identity and public Ticket context through the triggering requester
comment. The Local Ticket System verifies that context against its database,
then atomically writes a versioned structured internal note, assigns the exact
team (`Technical Team` / `Billing` / `General Support`), adds `ai-escalated`
and the normalized `ai-escalated:<reason>` tag, sets `open` status, and posts
one server-owned Customer acknowledgment. The Ticket-and-turn idempotency key
makes the handoff safe to retry after a crash; only a successful handoff moves
the worker item to terminal `ESCALATED`. The durable event remains auditable
for the human-avoidance metric.

## 7. Seed data

- **Cases:** 15–20 spread across every stage, including: one submitted "last
  Thursday" (the brief's status scenario), a delayed case, a delivered case, a
  customer with multiple cases, an evidence-insufficient case.
- **Customers:** matched to seed cases, with emails usable by the Local Ticket System.
- **Stage durations:** realistic standard durations per stage.
- **KB docs:** the 15–20 documents in §5.5, embedded at seed time.
- **Ticket routing:** the Local Ticket System accepts only `Technical Team`,
  `Billing`, or `General Support`; a future Zendesk adapter must map these values
  only after real provider access is validated.

## 8. Repo layout and local run

```
/
├── server/          # Fastify: agent core, channel adapters, case system, KB, eval
├── web/             # Vite/React: voice page + operator console
├── shared/          # shared types (events, tool calls)
├── docker-compose.yml  # Postgres + pgvector
├── CONTEXT.md       # domain glossary
└── docs/adr/        # 0001–0008
```

Current Local Ticket System run path: `docker compose up -d` →
`pnpm db:migrate` → `pnpm seed` → `pnpm dev`.
Run the current automated checks with `pnpm test`.

Current vendor environment: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, and
`ELEVENLABS_VOICE_ID`. Zendesk credentials and setup are future
administrator-owned work gated by OTHRM-29, not current runtime requirements.

## 9. Acceptance — eval scenario suite

Every scenario asserts the outcome end-to-end. This suite *is* the acceptance
bar, mapping 1:1 to the brief's use cases and evaluation criteria.

**Ticket scenarios:**
1. Case status ("sent it last Thursday") → resolved, computed timeline
2. Photo permission request → resolved (policy: always yes, cited)
3. Process question (evidence packaging) → resolved, KB-grounded
4. DNA mismatch / reprocessing → atomic escalation to Technical Team
5. Billing dispute → atomic escalation to Billing; billing question (invoice copy) → resolved
6. Off-topic (grant proposal) → polite redirect, no escalation
7. Unknown case number → honest not-found + specialist offer, no guess
8. Angry email about a delay → empathetic escalation
9. Customer with multiple cases → correct disambiguation

**Voice scenarios:**
10. Status check → spoken computed timeline
11. Angry caller → calm/quiet delivery (audio tags present), then escalation
12. Caller makes a joke → slight chuckle in reply
13. Off-topic voice request → polite redirect

**Scoreboard:** human avoidance rate, per-scenario pass/fail, routing
correctness, grounding/citation presence, redirect correctness.

## 10. Delivery

Repo (README, this PRD, CONTEXT.md, ADRs, eval scoreboard output) plus a
filmed demo of the voice page with the developer's own voice: angry-caller and
joke scenarios on camera, emotion readout visible. No cloud deployment.

## 11. Delivery sequence and backlog

**Delivery sequence:** OTHRM-17 adds durable escalation execution through
`TicketGateway`; OTHRM-31 packages the completed local ticket workflow.

**Post-demo backlog:**

- Real Zendesk adapter and end-to-end validation after provider access is restored
- Braintrust-based evals/observability (dashboards, LLM-as-judge) — supersedes
  nothing; layers on top of the in-repo runner
- Telephony (Twilio) as a third channel on the existing Voice pipeline
- Real Othram case-system adapter behind the Case System interface
- CSAT collection and human-baseline comparison
