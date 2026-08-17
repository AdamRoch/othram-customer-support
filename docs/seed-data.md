# Demo seed data

Run `pnpm db:migrate` and then `pnpm seed` to populate the local Case System.
The command is safe to re-run: it updates the fixed demo Customers, Cases, and
stage durations instead of creating duplicates.

## Zendesk requester emails

Use these documented demo identities when creating Zendesk trial Tickets. They
are deliberately under the reserved `.test` domain, so they are safe fixture
addresses and must be created through the Zendesk API or agent workspace rather
than sent email.

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

Standard stage durations live in
[`server/src/db/seed-data.ts`](../server/src/db/seed-data.ts), consistent with
[ADR 0004](adr/0004-timelines-computed-not-generated.md).
