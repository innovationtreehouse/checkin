# Lifecycle machines — running and regenerating

Two entities carry a written-down lifecycle: program enrollment
(`ProgramParticipant`) and the membership process (`OrgMembershipProcess`). Each
has one declarative definition naming its legal states, the query filter for each
state set, its transition table, and a `validate()` that flags rows sitting off
the diagram.

The rules those machines exist to hold are in `docs/rules/`; the discipline they
are built on is in `docs/conventions.md`. This file is how you operate them.

## Where things are

Run everything below from `checkin-app/`.

| Thing | Path |
|---|---|
| Shared primitives (state sets, transitions, classify/validate, enum parity) | `src/lib/lifecycle/` |
| Enrollment machine | `src/lib/programs/enrollmentState.ts` |
| Membership machine | `src/lib/membership/lifecycle.ts` |
| Generated diagrams, coverage matrix, reachability | `docs/generated/lifecycle/` |
| Off-diagram sweep | `src/lib/lifecycleDrift.ts`, `src/app/api/cron/lifecycle-reconcile/` |

## Regenerating the artifacts

The files under `docs/generated/lifecycle/` are machine-derived. **Never hand-edit
them.** After changing any machine's transitions, states, or the metadata the
artifacts render, regenerate and commit the result in the same change:

```bash
npm run generate:lifecycle-artifacts
```

The drift test regenerates in memory and compares byte-for-byte, so a stale
checked-in artifact fails CI. If the generator's own output format changes, this
is also the step that updates every artifact at once.

## Reading a red lifecycle test

Five guards cover this area, and each fails for a different reason:

- **Artifacts drift** — a machine changed and the generated files were not
  regenerated. Run the command above.
- **Guard ↔ transitions parity** — a compare-and-set guard's from-state no longer
  matches the transition table. The guard takes its from-state from the table;
  reconcile them rather than editing one side.
- **Status-literal allowlist** — new code hand-codes a set of statuses instead of
  consuming a state set's query filter. Consume the definition, or add an
  allowlist entry with a justification.
- **State-space safety** — the bounded state space is enumerated exhaustively and
  `classify` and `validate` disagreed somewhere in it. One of the two is wrong.
- **Enum parity** — a status was added to or removed from the Prisma enum without
  the machine's local union following.

## Off-diagram rows in production

A cron sweep scans both models with the machines' own `validate()`. It repairs
one case on its own — an enrollment holding a seat it has already been granted —
by releasing the seat back to the store. Everything else is reported to the
sysadmin and board channel, and shows up in System Status under **Lifecycle**, for
a person to resolve. Nothing ambiguous is changed automatically.

This is distinct from the store reconciliation cron, which recovers rows that are
*on* the diagram but stuck at a checkpoint because a webhook never arrived.
