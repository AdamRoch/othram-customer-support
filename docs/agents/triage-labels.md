# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker (OrbitTrack).

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

> **OrbitTrack-specific:** `ready-for-agent` is *derived*, not stored — OrbitTrack
> injects it at read time for issues with status `todo` and no unresolved blockers.
> Never create or apply it manually (the API refuses). To mark an issue AFK-ready:
> set status `todo`, specify it fully, and ensure its blockers are `done`.
> The other four labels exist as ordinary labels and are applied normally.
