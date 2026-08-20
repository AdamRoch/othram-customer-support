# Vendor smoke test (throwaway)

`server/scripts/vendor-smoke.ts` is a one-off feasibility spike for OTHRM-10.
It is not channel-adapter or production code. It runs four live vendor checks,
prints only sanitized results, and removes its generated test audio when it
exits.

Run it only after loading the private runtime environment into the current
shell. Do not copy that file into this repository or enable shell tracing.

```sh
set -a
source /Users/adam/firstmate/projects/othram-customer-support/.env
set +a
SMOKE_PLAY_AUDIO=1 pnpm smoke:vendors
```

`SMOKE_PLAY_AUDIO=1` is intentional: the check renders the same sentence with
`[calm]` and `[chuckles]`, plays each temporary clip locally, and fails if
either render is missing or both renders are byte-identical. The spike keeps no
audio response or ticket identifier. After a read-only identity request
succeeds, it creates and reads back exactly one plainly labelled, disposable
ticket in the developer-owned Zendesk trial. It does not create a ticket when
the identity request fails.

## Sanitized result — 2026-08-19

The live run loaded the approved private environment only into the command
process and retained no credentials, bearer tokens, provider payloads,
generated audio, or Zendesk ticket data.

| Check | Result | Sanitized note |
| --- | --- | --- |
| OpenAI tool calling | PASS | The model returned a toy function call and completed a second turn after its tool result. |
| ElevenLabs Scribe realtime | PASS | A Node WebSocket streamed generated PCM and received a nonempty committed transcript. |
| ElevenLabs v3 TTS audio tags | FAIL | The configured voice was rejected before v3 could render or play the `[calm]` and `[chuckles]` comparison. Follow-up: OTHRM-30. |
| Zendesk identity + ticket create/read | FAIL | The client-credentials grant minted a token, but the read-only identity request returned HTTP 403, so no test ticket was created. Real Zendesk validation remains blocked by the trial permissions. |

Real Zendesk validation remains unresolved until the trial permissions are
corrected and the command can create and read a disposable ticket. Under ADR
0008, the provider-limited local delivery proceeds with the PostgreSQL-backed
Local Ticket System behind TicketGateway. Local polling and eval results are
not Zendesk validation and must not be described as such.

The ElevenLabs v3 voice issue remains separate from the Local Ticket System
decision.
