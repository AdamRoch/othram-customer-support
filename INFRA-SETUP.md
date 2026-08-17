# INFRA-SETUP — manual steps only a human can do

Everything agents need but cannot create themselves: accounts, API keys,
dashboard settings, local tooling. Do Part 1 before agents reach the vendor
smoke-test spike ticket — it and every channel ticket consume these values;
they never create them.

Referenced by the vendor smoke-test spike ticket and the channel tickets.

---

## Part 1 — Before the spike ticket runs (blocking)

### 1. OpenAI

- [ ] Create an account at platform.openai.com and set up billing
      (pay-as-you-go is fine).
- [ ] Create an API key → save as `OPENAI_API_KEY`.
- [ ] Verify: `curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`
      returns a model list.

### 2. ElevenLabs

- [ ] Create an account at elevenlabs.io. Check your plan covers **Scribe
      (realtime STT)** and the **v3 TTS model** — the voice channel and
      Emotional Delivery depend on both; upgrade if the free tier excludes them.
- [ ] Create an API key → save as `ELEVENLABS_API_KEY`.
- [ ] Pick the agent's voice in the Voice Library → save its ID as
      `ELEVENLABS_VOICE_ID`. This is the voice customers hear; you'll want it on
      camera in the filmed demo, so pick one you like. Easy to change later.
- [ ] Verify: `curl https://api.elevenlabs.io/v1/voices -H "xi-api-key: $ELEVENLABS_API_KEY"`
      returns your voices.

### 3. Zendesk trial

- [ ] Sign up for a Zendesk Suite trial → note your subdomain
      (`<subdomain>.zendesk.com`) → save as `ZENDESK_SUBDOMAIN`.
- [ ] Admin Center → Apps and integrations → APIs → Zendesk API → enable token
      auth, add a token → save as `ZENDESK_API_TOKEN`. Save the login email as
      `ZENDESK_EMAIL`.
- [ ] Note the support address (`support@<subdomain>.zendesk.com`) — this is
      where demo emails are sent to create tickets.
- [ ] Do **not** create groups, tags, or macros manually — the
      `pnpm zendesk:setup` ticket provisions them via API.
- [ ] Verify: `curl -u "$ZENDESK_EMAIL/token:$ZENDESK_API_TOKEN"
      https://$ZENDESK_SUBDOMAIN.zendesk.com/api/v2/users/me.json` returns your user.
- [ ] **Timing note:** trials expire (~14 days). If it lapses mid-build, create
      a fresh trial, update the env values, and re-run `pnpm zendesk:setup` —
      scripted provisioning exists precisely so this is a 2-minute recovery.

### 4. Local tooling

- [ ] Node.js 20+ (`node --version`)
- [ ] pnpm (`pnpm --version`; `npm install -g pnpm` if missing)
- [ ] Docker Desktop, running (`docker info` succeeds) — runs Postgres+pgvector
- [ ] git (`git --version`)

### 5. Hand over the secrets

- [ ] Create `SECRETS.local.env` in this directory with:

```
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ZENDESK_SUBDOMAIN=
ZENDESK_EMAIL=
ZENDESK_API_TOKEN=
```

Agents wire these into the real `.env` (the scaffold ticket creates
`.env.example`), keep this file out of git, and never hard-code values.

---

## Part 2 — Optional, only if demoing webhook ingestion

Polling is the default ingestion path and needs nothing here. Only if you want
the real-time webhook demo:

- [ ] Create an ngrok (or similar) account and install the CLI.
- [ ] When the server runs: `ngrok http <server-port>`, then point a Zendesk
      webhook trigger at the tunnel URL (the webhook ticket documents the exact
      endpoint path).

---

## Part 3 — Demo day (yours, not the agents')

- [ ] Run the film-day checklist from the delivery-package ticket (seed
      verification, voice check, scenario rehearsal).
- [ ] Record the filmed demo: your own voice on the voice page — angry-caller
      and joke scenarios, with the emotion readout visible.

## Budget awareness

- OpenAI: embeddings are cents; the eval suite is the main token consumer —
  modest at this scale.
- ElevenLabs: STT minutes + TTS characters meter against plan credits; the
  demo scenarios are short, but repeated eval/dev runs add up — watch usage.
- Zendesk trial: free until expiry; see the timing note above.
