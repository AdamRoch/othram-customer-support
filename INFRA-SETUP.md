# INFRA-SETUP — manual steps only a human can do

Everything agents need but cannot create themselves: accounts, API keys,
dashboard settings, local tooling. Part 1 covers the current provider-limited
delivery under ADR 0008. Real Zendesk setup is unresolved future
administrator-owned work gated by OTHRM-29 and is not required to run the
Local Ticket System.

Referenced by the vendor smoke-test spike ticket and the channel tickets.

---

## Part 1 — Current provider-limited delivery

### 1. OpenAI (optional live development only)

The accepted `pnpm eval` path needs no vendor credential. OpenAI is required
only for `pnpm seed`, live `/api/chat`, or enabled Local Ticket System polling.

- [ ] Create an account at platform.openai.com and set up billing
      (pay-as-you-go is fine).
- [ ] Create an API key → save as `OPENAI_API_KEY`.
- [ ] Verify: `curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`
      returns a model list.

### 2. ElevenLabs (deferred voice feasibility)

ElevenLabs is not required for the current Local Ticket System delivery or its
evaluation. Keep these steps for the future voice target only; they do not
prove a current browser voice channel or Emotional Delivery.

- [ ] Create an account at elevenlabs.io. Check your plan covers **Scribe
      (realtime STT)** and the **v3 TTS model** — the voice channel and
      Emotional Delivery depend on both; upgrade if the free tier excludes them.
- [ ] Create an API key → save as `ELEVENLABS_API_KEY`.
- [ ] Pick the agent's voice in the Voice Library → save its ID as
      `ELEVENLABS_VOICE_ID`. This is the voice customers hear; you'll want it on
      camera in the filmed demo, so pick one you like. Easy to change later.
- [ ] Verify: `curl https://api.elevenlabs.io/v1/voices -H "xi-api-key: $ELEVENLABS_API_KEY"`
      returns your voices.

### 3. Future Zendesk adapter (OTHRM-29, not current setup)

This section preserves the target administrator setup for OTHRM-29. Do not
treat it as a prerequisite or evidence for the current delivery. The existing
trial cannot perform Ticketing operations, and the repository does not provide
a Zendesk provisioning command.

- [ ] Sign up for a Zendesk Suite trial → note your subdomain
      (`<subdomain>.zendesk.com`) → save as `ZENDESK_SUBDOMAIN`.
- [ ] Admin Center → Apps and integrations → APIs → OAuth clients → add a
      **Confidential** OAuth client while signed in as an active Zendesk Support
      administrator. In its **Scopes** field, allow the required `read` and
      `write` Ticketing API scopes. Redirect URLs are not needed for the client
      credentials flow. Save its Identifier as `ZENDESK_CLIENT_ID` and copy its
      one-time Secret as `ZENDESK_CLIENT_SECRET`.
- [ ] Note the support address (`support@<subdomain>.zendesk.com`) — this is
      where demo emails are sent to create tickets.
- [ ] Do not create groups, tags, or macros until OTHRM-29 defines and validates
      the adapter's provisioning path.
- [ ] Verify the credentials with the read-only check below. It exchanges the
      client credentials on the server-to-server token endpoint for a 10-minute,
      read-only access token, keeps that token in shell memory, prints only a
      small user summary, and then clears the variables. Keep shell tracing off:

```sh
(
  set +x
  set -eu
  TOKEN_RESPONSE="$(
    curl --silent --show-error --fail \
      "https://$ZENDESK_SUBDOMAIN.zendesk.com/oauth/tokens" \
      -H "Content-Type: application/json" \
      --data "$(jq -nc \
        --arg client_id "$ZENDESK_CLIENT_ID" \
        --arg client_secret "$ZENDESK_CLIENT_SECRET" \
        '{grant_type: "client_credentials", client_id: $client_id, client_secret: $client_secret, expires_in: 600}')"
  )"
  ACCESS_TOKEN="$(printf '%s' "$TOKEN_RESPONSE" | jq -er '.access_token')"
  unset TOKEN_RESPONSE
  curl --silent --show-error --fail \
    "https://$ZENDESK_SUBDOMAIN.zendesk.com/api/v2/users/me.json" \
    -H "Authorization: Bearer $ACCESS_TOKEN" |
    jq '{user: {id: .user.id, name: .user.name, role: .user.role}}'
  unset ACCESS_TOKEN
)
```

Zendesk derives a client-credentials token's permissions from the OAuth client
owner. Do not send an explicit `scope` unless the trial has confirmed that scope
is accepted. Do not add `--verbose`, echo either credential, print the token
response, or save the access token to disk.
- [ ] **Timing note:** trials expire. Start or renew a trial only when an
      administrator is executing OTHRM-29.

### 4. Local tooling

- [ ] Node.js 20+ (`node --version`)
- [ ] pnpm (`pnpm --version`; `npm install -g pnpm` if missing)
- [ ] jq (`jq --version`) — needed only for the future OTHRM-29 credential check
- [ ] Docker Desktop, running (`docker info` succeeds) — runs Postgres+pgvector
- [ ] git (`git --version`)

### 5. Hand over optional development secrets

- [ ] Create `SECRETS.local.env` in this directory only when using the optional
      live OpenAI development path:

```
OPENAI_API_KEY=
```

Keep this file out of git and never hard-code values. ElevenLabs values belong
to deferred voice work, not this current delivery.

An administrator executing OTHRM-29 supplies the documented Zendesk values at
that time. They are not current Local Ticket System configuration.

---

## Part 2 — Future Zendesk webhook work (OTHRM-29)

The current Local Ticket System uses cursor reads and needs nothing here. These
steps apply only after OTHRM-29 delivers and validates a real Zendesk adapter:

- [ ] Create an ngrok (or similar) account and install the CLI.
- [ ] When the server runs: `ngrok http <server-port>`, then point a Zendesk
      webhook trigger at the tunnel URL (the webhook ticket documents the exact
      endpoint path).

---

## Part 3 — Current local workflow walkthrough

- [ ] Follow the provider-free `EVAL_DATABASE_URL` setup and `pnpm eval`
      commands in `README.md`.
- [ ] Confirm the three local scenarios and deterministic scoreboard.
- [ ] Treat voice, Emotional Delivery, webhook, operator-console, and filmed
      demo work as deferred target scope, not current acceptance evidence.

## Budget awareness

- OpenAI: optional seed embeddings and live development consume usage; the
  accepted local eval makes no OpenAI calls.
- ElevenLabs: future voice feasibility consumes STT/TTS usage; it is not part
  of the current local ticket workflow.
- Future Zendesk trial: administrator-owned cost and expiry management under OTHRM-29.
