# "Index" — searchable page directory: scoping record

**Status: SHIPPED (MVP).** `/index` (`src/app/index/page.tsx`) lists every page a
signed-in user may reach, filtered by a search box, from the flat registry in
`src/components/pageRegistry.ts` (`PAGES` + `REGISTRY_EXCLUDED`). A drift-guard
test (`src/__tests__/pageRegistry.test.ts`) keeps the registry honest. Nav item
sits directly below Settings (`NAV_ITEMS` in `AppFrame.tsx`).

## The decisions worth keeping

**Reuse the section gates; never re-implement them.** Route authorization already
lives in two layers: top-level `NAV_ITEMS[].visible` predicates and each
section's `layout.tsx` `useRequireRole`. A sub-page inherits its section's gate
(`/system-status/audit-log` is reachable iff `/system-status` is), so the
registry needs a per-route → **section-predicate** mapping, not a per-route
permission table. One predicate per section, attached to each of its routes; a
route gets its own `visible` override *only* if its gate ever diverges from its
section. This is the single source of truth the registry must read, not fork.

**The Index grants nothing.** It renders only rows whose `visible()` passes, and
every target still enforces its own `useRequireRole` on arrival — it is a
convenience layer over existing gates. That is why the nav item is visible to
**all** signed-in users: showing the directory leaks nothing.

**Drift is guarded by a test, not vigilance.** A flat list rots as routes are
added. The shipped guard walks `src/app/**/page.tsx` and asserts every
non-dynamic route is either in `PAGES` or explicitly in `REGISTRY_EXCLUDED` (and
that nothing points at a route that no longer exists). Dynamic `[id]` detail
pages are excluded — you reach them from a list, not by name.

## Still open / deferred (verified against the tree)

- **Command palette** (Cmd-K overlay) — deferred; `pageRegistry` is exactly its
  data source. Not built.
- **Derive `NAV_ITEMS` from the registry** — deferred; the two lists are still
  separate (`NAV_ITEMS` is hand-maintained in `AppFrame.tsx`). The predicate
  logic is shared; collapsing the lists is a refactor with its own blast radius,
  do it once the registry proves out.
- Dynamic detail pages in results, per-row todo badges, recently-visited /
  favorites ordering — all deferred, none built.

*(Resolved since drafting: `/membership` and `/trusted-adults` are live personal
routes — both registered in `PAGES`, distinct from `/safety/trusted-adults`. The
earlier "legacy duplicate?" open question is closed.)*
