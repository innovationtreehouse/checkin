# Sequencing the target security architecture

**Status: PROPOSED. The build/migration order for
[TARGET_SECURITY_ARCHITECTURE.md](TARGET_SECURITY_ARCHITECTURE.md). That
document is the design; this one is only the order of operations, kept
separate so the strategy stays free of plan detail.**

Ordered so every step is independently shippable and the test floor arrives
before the construction ceiling:

1. **Decide the design's open issues**; several change what gets built.
2. **Graduate leak-critical business rules to scopes** (`org_members`
   first). Registry-only PRs, boundary-isolation compliant.
3. **Persona row-contract walker** (#1134 Step 1) with ceiling semantics
   over registered GET routes; convert `EDGE_INCLUDE_ALLOWLIST` prose to
   `rows:` declarations as routes gain them. The **governance report
   generator** ships here too; the same declarations feed both.
4. **`rowsWhere` + property-based equivalence** (#1134 Step 2, with the
   in-thread fail-closed requirements): the first half of the compiler,
   not an optional ergonomic.
5. **Select generation + the scoped facade**: the second half. New and
   migrating routes get `db` instead of raw prisma; strip-tripwire
   telemetry lands with it. The facade's equivalence tests must include
   the `where`-composition collision cases the design pins (route `OR:`
   blocks, key shadowing, empty fragments; "wrap, never spread").
6. **Registry conversion as a tracked program: one hop, all of
   `withAuth`.** The endgame is decided in the design: every `withAuth`
   route migrates (reads first), and each route migrates **once, directly
   to the facade form**, not `withAuth` → bare `handler()` → facade in
   two passes. Because the strategy is set before the bulk conversion
   starts, the intermediate form never needs to exist at scale: bulk
   conversion *waits for step 5*, then proceeds as one wave per route;
   the 14 routes already on `handler()` pick up the facade as part of
   that wave. The non-session wrappers (`withKiosk`, `withCron`,
   `withWebhook`) are excluded from this mandate; their treatment is
   designed in the strategy's "Surfaces without a session caller"
   section.
7. **Walker extended to writes** (I4).
8. **RLS pilot** on the highest-sensitivity tables, if adopted (design
   open issue 1, decided jointly with the portfolio).

## Process question carried from the design

118 single-route migrations under the two-PR boundary-isolation rule is
real friction; if it depresses conversion velocity that is itself a
security cost. Decide whether mechanical registrations get a batch lane
before step 6 starts.
