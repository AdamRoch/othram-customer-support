# Seed and reference data

There are two deliberately separate paths.

## Accepted provider-free evaluation

`pnpm eval` does not run `pnpm seed` and never calls OpenAI or Zendesk. Give it
an explicit `EVAL_DATABASE_URL` whose database name contains `eval`, apply
migrations to that same URL, then run the evaluator:

```sh
export EVAL_DATABASE_URL=postgresql://othram:othram@127.0.0.1:5432/othram_eval
DATABASE_URL="$EVAL_DATABASE_URL" pnpm db:migrate
pnpm eval
```

Migration `0005_stage-duration-defaults.sql` is the deterministic reference
bootstrap for this path. It writes the eight canonical stage durations. The
evaluator fails closed if any stored duration differs, creates its own
run-scoped case and local tickets, and removes them afterwards. Its photo
permission result is drawn from the versioned `Media Permission Policy` source
in `server/src/knowledge/10-media-permission-policy.md`; the deterministic
eval model verifies the citation through the normal Agent Core tool path.

## Optional live OpenAI seed

Set `OPENAI_API_KEY`, run `pnpm db:migrate`, then run `pnpm seed` to populate
the local Case System and embed the bundled knowledge documents with
`text-embedding-3-small`.

```sh
pnpm db:migrate
pnpm seed
```

The command is safe to re-run: it updates the fixed demo Customers, Cases,
stage durations, and KB chunks instead of creating duplicates. If the API key
is missing or OpenAI returns an invalid embedding response, it exits before
writing any seed changes. This path is useful for local live-chat and polling
development; it is not part of the accepted provider-free evaluation.

## Local Ticket System requester emails

Use these documented demo identities when creating Local Ticket System Tickets.
They are deliberately under the reserved `.test` domain, so they are safe
fixture addresses and must not be sent email. A future Zendesk adapter may use
the same identities only after provider access is independently validated.

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
