# Demo seed data

Set `OPENAI_API_KEY`, run `pnpm db:migrate`, and then run `pnpm seed` to
populate the local Case System and embed the bundled knowledge documents with
`text-embedding-3-small`. The command is safe to re-run: it updates the fixed
demo Customers, Cases, stage durations, and KB chunks instead of creating
duplicates. If the API key is missing or OpenAI returns an invalid embedding
response, the command exits before writing any seed changes.

## Local Ticket System requester emails

Use these documented demo identities when creating Local Ticket System Tickets.
They are deliberately under the reserved `.test` domain, so they are safe
fixture addresses and must not be sent email. A future Zendesk adapter may use
the same identities after real provider access is validated.

| Customer | Email | Cases |
|---|---|---|
| Jordan Lee | `jordan.lee@othram-demo.test` | OTH-2026-0142 (submitted last Thursday) |
| Maya Collins | `maya.collins@othram-demo.test` | OTH-2026-0143, OTH-2026-0144, OTH-2026-0153 |
| Detective Aaron Bell | `aaron.bell@othram-demo.test` | OTH-2026-0145 |
| Priya Shah | `priya.shah@othram-demo.test` | OTH-2026-0146 (delayed) |
| Sgt. Elena Torres | `elena.torres@othram-demo.test` | OTH-2026-0147 |
| Noah Williams | `noah.williams@othram-demo.test` | OTH-2026-0148 |
| Dana Brooks | `dana.brooks@othram-demo.test` | OTH-2026-0149 (delivered) |
| Alex Morgan | `alex.morgan@othram-demo.test` | OTH-2026-0150 (insufficient evidence) |
| Lt. Samira Khan | `samira.khan@othram-demo.test` | OTH-2026-0151 |
| Casey Nguyen | `casey.nguyen@othram-demo.test` | OTH-2026-0152 |
| Morgan Price | `morgan.price@othram-demo.test` | OTH-2026-0154 |
| Riley Chen | `riley.chen@othram-demo.test` | OTH-2026-0155 |
| Jamie Patel | `jamie.patel@othram-demo.test` | OTH-2026-0156 |
| Taylor Reed | `taylor.reed@othram-demo.test` | OTH-2026-0157 |

Standard stage durations are defined in
[`server/src/db/seed-data.ts`](../server/src/db/seed-data.ts), consistent with
[ADR 0004](adr/0004-timelines-computed-not-generated.md). The versioned
[`0005_stage-duration-defaults.sql`](../server/drizzle/0005_stage-duration-defaults.sql)
migration bootstraps those canonical values. Apply migrations before the seed
command or deterministic local evaluation; the evaluator fails closed if the
stored values are missing or changed.
