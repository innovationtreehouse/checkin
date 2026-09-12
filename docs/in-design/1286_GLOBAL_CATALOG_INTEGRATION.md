# Global catalog: porting `global-catalog-app` into checkin

**Issue:** [#1286](https://github.com/innovationtreehouse/checkin/issues/1286)
— backlog item CI1 (PORT · NEEDS-DESIGN · XL).

**Status:** design. No board decision gates the mechanics below; the one product
choice (which staff may operate the catalog) is settled in §6.

**Source:** `global-catalog-app/` in the `innovationtreehouse/Inventory` repo
(local: `/Volumes/Untitled/Inventory/global-catalog-app`). Not currently
deployed in Infra.

---

## 1. Goal and shape

Bring the global catalog into checkin as **more nav items in the existing
checkin app — one Next.js process, one Infra deploy** — not a second service.

**The whole app — domain *and* UI — lands as an isolated library package**
(`@inventory/global-catalog`): services, repositories, workflows, Prisma
schema/client, and every React component, page, and route handler. `checkin-app`
holds **only structural wiring, no catalog logic**: filesystem-routing re-export
stubs, one `configureCatalog()` boot call that injects checkin's auth + DB, a nav
splice, and the security-registry entries (§3). The dependency arrow points one
way — **the library never imports checkin; checkin injects into the library.**
The library boundary is the point: it forces the catalog to stay decoupled from
checkin internals, and keeps "understand the catalog" = "read the package" true —
a catalog change never means analyzing `checkin-app`.

This is the **first move of an eventual whole-Inventory migration**. Where the
catalog touches Inventory apps that have not moved yet (receipt-app), we bring
**temporary copies** across even if that duplicates a Prisma schema or a type —
temporary meaning **< 2 weeks, dev-only, never in a release**. Clean APIs get
defined at each crossing so the temporary seam is explicit and removable.

### Decisions locked (from design Q&A)

| Question | Decision |
|---|---|
| DB topology | **Own dedicated database** (`CATALOG_DATABASE_URL`) on the **same Postgres server** — separate `schema.prisma` + own Prisma client + own migrations. Precedent: `@inventory/monitoring-db` (own `MONITORING_DATABASE_URL`). A dedicated DB namespaces the generic tables, so no renames. |
| Security regime | **Adopt checkin's** registry + `@sensitivity` generator + stripper + scopeBindings **over the separate schema/routes**, even though the schema file stays separate. |
| Auth | **Retire** `global-catalog-app`'s `@inventory/auth` + `@inventory/web-auth`. checkin next-auth session is the only auth. |
| Roles | One **new** checkin role: `INVENTORY_MANAGER` (source's global- and org-manager collapse into it for now). Viewer = any RBAC-role holder, program leader, or volunteer (not any authenticated user). See §6. |
| Scope | **Full port**, including receipt-facing pieces, with temporary shims at not-yet-migrated app boundaries. |
| UI location | **All UI in the library** — components, pages, route handlers. checkin-app only re-exports and mounts (§3). |
| UI style | **Reskin in place** for the first landing: keep the API-route + `*Client.tsx` pattern; re-auth + re-theme. Convert hot pages to server components later (also in the library). |

---

## 2. What the source is

`global-catalog-app` is a Next 16 / React 19 / Mantine 7 / Prisma 7 app — the
**same stack checkin already runs** (identical Mantine, tabler-icons, Prisma,
pg-adapter, Next, React versions). It is cleanly layered:

```
src/
  repositories/   catalog, itemReference, proposal, conversionChallenge, orgEvent   (Prisma access)
  services/       categoryService, itemService, proposalService, referenceMatchingService,
                  provisionalGtinService, conversionChallengeService,
                  conflictResolutionService, orgEventService                          (domain logic)
  workflows/      xstate state machines (proposal/supersession lifecycle)
  lib/            gtin, normalizeDescription, validate  (portable)
                  auth, auth-shared, auth-predicates, route-auth  (RETIRE — see §5)
  app/api/…       route handlers (thin: parse → service → response)
  components/…    *Client.tsx client components (Mantine)
  db/, generated/ Prisma client
prisma/schema.prisma   11 models (own migrations)
```

**Prisma models** (own schema, `@@map` to snake_case tables): `Category`,
`Subcategory`, `Item`, `ItemReference`, `ReferenceConflict`,
`ItemReferenceProposal`, `ConversionChallenge`, `ProvisionalPartSequence`,
`ProvisionalItem`, `ProvisionalItemMappingLog`, `WorkflowTransitionLog`,
`OrgEvent`.

The domain layer is framework-light and ports almost verbatim. The friction is
**auth and UI wiring**, not the domain.

### Workspace dependencies — what the source uses today vs. what we bring

The source **currently** depends on `@inventory/{auth, web-auth, gtin,
workflows, receipt-types, receipt-contract-fixtures, pg-test-harness}`. We do
**not** bring all of them. checkin already vendors `@inventory/{money,
pg-test-harness, …}` under `packages/`, so the vendoring mechanism exists.
Disposition:

| Source package | Ported? | Action |
|---|---|---|
| `@inventory/auth`, `@inventory/web-auth` | **No — dropped** | Not brought across. These *are* the source's auth system, which is retired (§6). Every use is replaced by checkin next-auth. |
| `@inventory/gtin` | Yes | **Own `packages/gtin`** — NOT inside `global-catalog`. Shared, cross-app (GTIN normalization/validation, domain-pure); receipt-app uses it too. |
| `@inventory/workflows` | Yes | **Own `packages/workflows`** — shared xstate helpers, not catalog-specific. |
| `@inventory/receipt-types`, `receipt-contract-fixtures` | Yes (temporary) | **Own `packages/`, temporary copies** — the receipt↔catalog contract; becomes the permanent shared contract when receipt-app migrates (§8). |
| `@inventory/pg-test-harness` | n/a | Already present in checkin. Reuse. |

Two things to keep straight:

- **auth/web-auth** are the one group deliberately **left behind** — they *are*
  the source's auth system, retired for checkin auth (§6).
- **gtin / workflows / receipt-types stay standalone shared packages**, siblings
  of `global-catalog`, **not folded into it.** They are cross-app utilities/
  contracts (receipt-app and future Inventory apps consume them), so burying them
  inside the catalog library would recreate the coupling we're trying to remove.
  Only genuinely catalog-specific helpers (`validate`, `normalizeDescription`)
  live inside `global-catalog/src/lib`.

---

## 3. Target layout — the meat lives in the library

**Goal: a developer working on the catalog works entirely inside
`packages/global-catalog`.** checkin-app must never accumulate catalog *logic* —
only the minimum structural wiring that Next's filesystem router and checkin's
security model genuinely require. "Analyze checkin-app to understand the
catalog" should never be true.

The library owns **everything with substance**: services, repositories,
workflows, `lib`, the Prisma schema/client/migrations, **the React components,
the page components (server + client), the route handlers, and the nav
manifest.** `@inventory/money` already proves the mechanism — checkin consumes a
workspace package as raw TS source. A package that also ships **tsx** needs one
line in next.config (`transpilePackages`).

```
checkin/
  packages/
    global-catalog/                       ← the whole app, as a library
      src/
        repositories/  services/  workflows/  lib/       domain (ported verbatim)
        prisma/schema.prisma  prisma/migrations/  generated/   separate schema+client
        components/                        ALL catalog UI (Mantine, reskinned)
        pages/                             page components — server + client
        routes/                            route-handler factories (GET/POST/…)
        nav.ts                             exported nav manifest (catalogNav: NavItem[])
        runtime.ts                         configureCatalog() + getPrincipal()/db accessors
        contract.ts                        CatalogAuth / CatalogPrincipal interfaces
      package.json
    gtin/  workflows/                      vendored @inventory/* deps
    receipt-types/                         TEMPORARY vendored copy
  checkin-app/                             ← WIRING ONLY, no catalog logic
    src/instrumentation.ts                 + one configureCatalog({...}) call at boot
    src/app/(catalog)/**/{page,route}.tsx  re-export stubs (see below)
    src/lib/nav*                           splice in `catalogNav` from the library
    src/security/{registry,scopeBindings}.ts   + catalog entries (boundary is checkin's)
    next.config.ts                         + transpilePackages: ['@inventory/global-catalog']
```

### The cut — what's forced into checkin-app, and why it's thin

Next's App Router discovers routes by **filesystem**, so *some* files must
physically sit under `checkin-app/src/app`. That is the only structural
concession. We make each one a **one-line re-export** of a library module, so it
carries no logic:

```ts
// checkin-app/src/app/(catalog)/catalog/items/page.tsx
export { default } from '@inventory/global-catalog/pages/items'

// checkin-app/src/app/(catalog)/api/catalog/items/route.ts
export { GET, POST } from '@inventory/global-catalog/routes/items'
```

These stubs mirror the library's route map (~20 files). They are generated once
(a small script can emit them from a route manifest, or hand-write them — they
change only when a *new* route is added, which is a deliberate act anyway).

**Auth + DB injection without the library importing checkin:** the library
declares interfaces in `contract.ts` (`CatalogPrincipal`, `CatalogAuth` with
`getPrincipal()` / `requireManager()` / `isViewer()`). checkin-app calls
`configureCatalog({ auth, db })` **once** in `instrumentation.ts`, passing a
next-auth-backed `CatalogAuth` and the connection. Pages and route handlers read
the configured runtime — so the stubs stay pure re-exports and the library's
import graph never reaches into checkin. (`configureCatalog` is an app-boot
singleton — the one justified global; the ceiling is "one runtime per process,"
fine for a single Next app.)

**So the total checkin-app footprint is:** the stub tree (trivial, stable), one
`configureCatalog` call, a nav splice (`catalogNav` array rendered by checkin's
shell), the security registry entries (§5 — a checkin boundary artifact by
design, and mostly `public`), one next.config line. None of it is catalog logic.
Everything a catalog change touches lives in `packages/global-catalog`.

**Honest residue** — three things structurally cannot leave checkin-app, all
mechanical/config, none "meat": (1) the FS-routing stub files; (2) their
`pageRegistry` entries (checkin's drift guard fails otherwise — project memory);
(3) the security registry/scopeBindings entries (checkin centralizes the
boundary on purpose — do not fight it). Adding a *new* catalog route touches all
three; editing catalog behavior touches none.

---

## 4. Database — its own database on the shared server

The catalog gets its **own dedicated database** (its own `CATALOG_DATABASE_URL`)
on the **same Postgres server** as checkin — separate `schema.prisma`, separate
Prisma client (own `generator client` output), own migration history.

**Precedent, followed exactly:** `@inventory/monitoring-db` — *"a separate
database from any watched service (its own `MONITORING_DATABASE_URL`)"* — same
server, dedicated DB, its own connection string read via `process.env`. The
catalog mirrors this.

Rationale: strongest isolation, LLM development touches one small schema, **and
it dissolves the table-naming problem** — a dedicated database namespaces the
catalog's generic tables (`categories`, `items`, `org_events`, …) completely, so
they never collide with checkin's, no schema prefix and **no model/table
renames needed**. (An in-code clarity rename of the most generic model —
`OrgEvent` — is optional, not required; the catalog's Prisma types live in their
own generated client and don't collide with checkin's types. Keep source names
to minimize port churn; rename only if a shared call site reads ambiguously.)

Implications:

- **Two Prisma clients** load in the checkin-app process (catalog +
  checkin), each with its own connection string / pool. Same as
  monitoring-db + checkin today.
- **No cross-database SQL** (can't JOIN catalog ↔ checkin). By design — the
  catalog↔checkin/receipt crossings are service-level calls (§8), never SQL
  joins, and the S5 outbox lives entirely inside the catalog DB. A transaction
  never needs to span both.
- **Migrations run independently.** The catalog keeps its `prisma/migrations/`;
  checkin's migration flow (`DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md`) governs
  checkin's DB only. Add a catalog `migrate deploy` step (against
  `CATALOG_DATABASE_URL`) to the deploy sequence.
- **`db push` caveat** (see project memory): the catalog schema likely relies on
  partial unique indexes the Prisma schema can't express; use `migrate deploy`,
  not `db push`, for any DB the P2002/uniqueness tests run against.

---

## 5. Adopting checkin's security regime over a separate schema

checkin's security boundary is a **Prisma generator**: `generator security` in
`prisma/schema.prisma` runs during `prisma generate` and emits
`src/security/generated/classifications.ts` from `@sensitivity:` annotations.
The registry/handler/stripper/scopeBindings consume that.

To bring the catalog under the same regime **without merging schemas**:

1. **Add `@sensitivity:` annotations** to every field in the catalog schema.
   The reference data is generic — `name`, GTIN, `description`,
   `conversionFactor`, codes, `orgName`, `archivedAt` are **`public`**. The
   only non-public fields are **`internal`**, in three groups:
   - **Actor attribution** — `*ByUsername`, `*ByUserId`, `localUserId`,
     `reviewedByUserId`, `resolvedByUserId`, `mappedByUserId`,
     `transitionedByUserId` (who did what).
   - **Free text** — `rejectionReason`, `reason`, `note` (may carry incidental
     sensitive text).
   - **Cross-app plumbing** — `OrgEvent.payload`, `receiptId`.

   **No `pii` tier is needed** — the catalog schema has no email/DOB/address
   fields (the one email lives on checkin's `VolunteerDesignation`, outside the
   catalog). So per-field stripping is light: `public` reference data flows to
   the viewer tier; the `internal` attribution/plumbing stays behind
   `everyones:internal`.
2. **Add a `generator security` block to the catalog schema** so
   `prisma generate` emits a **second classifications file** for catalog models
   (e.g. `src/security/generated/catalog-classifications.ts`). Merge/import both
   in the security core.
3. **Register every catalog route** in `src/security/registry.ts` with the
   right scope/tier tokens, and add **scopeBindings** for catalog access
   resolvers.
4. Route responses go through checkin's **stripper** like any other route.

**Boundary-isolation process applies** (`AGENTS.md` + the
`security-boundary-isolation` workflow): registry/scopeBindings/generator
changes ship in their **own PR(s)**, ahead of the route code. Land the registry
entries first (an unused `defineRoute` is inert), then the routes. This is the
single most process-heavy part of the port — plan it as its own PR track.

---

## 6. Auth and roles

**Retire the source auth entirely.** Delete `lib/auth.ts`, `auth-shared.ts`,
`auth-predicates.ts`, `route-auth.ts`, `LoginForm`, and `/api/auth/{login,
logout,me}`. checkin already owns login and session.

Every catalog route/page guard is re-expressed against the checkin session
(`getServerSession(authOptions)` + role/predicate check).

### Role mapping — one manager role + a broad viewer gate

Source tiers → checkin:

| Source tier | checkin |
|---|---|
| **global-manager** + **org-manager** | **one new role** `INVENTORY_MANAGER` (collapsed for now; split later if a multi-org need appears) |
| **viewer** | any **RBAC-role holder, program leader, or volunteer** — not any authenticated user |

**Adding the role** touches checkin's role foundation (all in checkin's own
schema, not the catalog schema):

- `PersonRoleKind` enum in `prisma/schema.prisma` (currently SYSADMIN, BOARD,
  KEYHOLDER, BG_REVIEWER, OPERATIONS) — add `INVENTORY_MANAGER`. Following the
  `isOperations` precedent, it is **PersonRole-table-only, no legacy mirror
  column**.
- `src/lib/roles.ts` `FLAG_TO_KIND` map (+ derived `ROLE_FLAGS`, `rolesToFlags`).
- `src/types/next-auth.d.ts` JWT/Session interfaces (surface the new flag).
- `RoleBadge` + the `/api/roles` grant UI (grantable by sysadmin, matching the
  existing matrix).

**Viewer predicate**: a new `isCatalogViewer(session)` = authenticated **and**
any of — holds `INVENTORY_MANAGER`, holds **any** `PersonRole` (RBAC role),
`programsLed` non-empty (program leader), or has a `VolunteerDesignation` (keyed
by email; volunteer). This is the single chokepoint for read access.

Per-route authorization then reads: **writes** → `INVENTORY_MANAGER`; **reads** →
`isCatalogViewer`.

---

## 7. UI — reskin in place

All UI lives in the library (`packages/global-catalog/src/{components,pages}`).
checkin-app only re-exports pages (§3) and splices `catalogNav`. Both apps use
the same Mantine version, so the reskin is component-level, not a rewrite.

For the first landing, **keep the source's API-route + `*Client.tsx` pattern**;
re-theme to checkin and re-wire auth:

- Drop the source `Layout`/nav shell. Catalog pages render inside checkin's
  shell (the checkin layout wraps the `(catalog)` route group); the library
  exports `catalogNav` for checkin's nav to render, gated by `isCatalogViewer`.
- Keep `CategoriesClient`, `GlobalInventoryClient`, `ItemReferenceProposalsClient`,
  `ConversionChallengesClient`, `ProvisionalProposalsClient`, etc. **in the
  library**; restyle to checkin conventions and point their `fetch` calls at the
  `/api/catalog/*` routes (whose handlers are library factories).

"More server-driven" is the **eventual** target (§1) and also lands in the
library: convert the read-heavy pages (catalog browse, proposal queues) to
server components calling the services directly and delete their `/api/*` GET
routes. Because pages already live in the package, that conversion never touches
checkin-app. Not in the first PR track.

---

## 8. Receipt-app crossings — when HTTP becomes an in-process call

**Receipt-app also migrates into this same Next process** (later). So today's
cross-app HTTP calls between catalog and receipt-app become **in-process
cross-library calls**. This section fixes *when and how* each crossing converts.
Guiding decisions: **keep the JSON/contract shapes** (they stay the shared
vocabulary — remove a schema only if a field genuinely dies); convert
**transport, not architecture**.

### The two crossing archetypes (from the source)

| Crossing | Direction | Kind | Contract | Today's transport |
|---|---|---|---|---|
| **S4** — `provisional-gtin/next`, `items/lookup` (3-pass matcher), `items/check-references`, item-reference / provisional-item proposals, conflict report | receipt → catalog | **synchronous RPC** | `@inventory/receipt-types` zod schemas | `POST /api/internal/[...path]`, org-bearer auth |
| **S5** — `emitOrgEvent(tx, orgId, payload)` | catalog → world | **async outbox** — validated payload written to the `OrgEvent` table in-transaction, drained by a poller/consumer | `orgEventPayloadSchema` (S5) | table write + polled read |

These convert **differently** — that is the whole point of deciding now.

### Conversion rule (per crossing)

1. **Trigger = co-residence.** Convert a crossing only once **both** libraries
   run in the same process **and** the callee's service surface is importable.
   Never depend on unlanded code; convert crossing-by-crossing, not big-bang.
2. **Every crossing sits behind a port** (an interface in `contract.ts`) with
   **two adapters**: `http` (today) and `in-process` (after co-residence). The
   binding is chosen once in `configureCatalog()`. **Converting a crossing = swap
   one adapter binding — zero call-site churn.** The port's types *are* the JSON
   contract, so the shape is identical in both modes.
3. **Synchronous RPC (S4):** at co-residence, bind the in-process adapter — the
   caller imports the catalog service function directly (via the port) instead of
   the `catalog-client` HTTP stub. Keep the zod schemas as the function
   param/return types. **Retire the `/api/internal/*` route + org-bearer auth
   last** — only after the final remote caller has flipped (during the overlap
   window a remote receipt-app may still call it).
4. **Async outbox (S5):** **do NOT collapse to a direct call.** The outbox
   (durable `OrgEvent` rows, in-transaction write, retry/ordering/audit) has
   value independent of transport. At co-residence the consumer stops
   HTTP-polling the producer and instead **reads the shared `OrgEvent` table
   in-process** (or a shared in-process bus), but the async seam stays. Collapse
   to a synchronous call only with a specific reason; default is keep.
5. **JSON structure stays.** The contract package (`receipt-types` S4 schemas,
   the S5 `orgEventPayload` schema) remains the shared vocabulary in both modes.
   The vendored copy (below) is temporary **as a copy** — it becomes the
   permanent shared `packages/` contract once receipt-app lands. Delete a schema
   only when its field genuinely dies, not merely because the call went
   in-process.

### First landing (catalog in, receipt-app not yet)

- Vendor `@inventory/receipt-types` + `receipt-contract-fixtures` as
  **temporary copies** (mark with a `ponytail:` removal note + tracking
  follow-up). Endgame: promote to a shared `packages/` contract when receipt
  arrives.
- Keep the **S4 `/api/internal/*` route live** (org-bearer) so a still-remote
  receipt-app can call it during the overlap — it is the `http` adapter's
  server side. It flips off per rule 3 when receipt co-resides.
- The **S5 consumer / org-events poller** has no producer in checkin yet: land
  it **inert** (no scheduled invocation) behind a flag until receipt-app
  migrates. The outbox producer (`emitOrgEvent`) can run from day one — rows
  simply accumulate until a consumer is enabled.
- Provisional-from-receipt paths stay reachable via the catalog's own manual
  routes (as the source already supports) until the receipt producer exists.

All temporary duplication is **< 2 weeks, dev-only** by the stated philosophy —
acceptable, tracked for removal.

---

## 9. Infra / deploy

The catalog adds **no new service**. It compiles into `checkin-app`'s build and
ships in checkin's existing container (`deploy/docker-compose.prod.yml` +
`Caddyfile`; Infra `checkin-bootstrap` module). Deploy changes:

- Build the new `packages/*` (workspace build already covers `packages/*`).
- **Provision the dedicated catalog database** on the existing Postgres server
  and its `CATALOG_DATABASE_URL` secret — mirroring how `MONITORING_DATABASE_URL`
  / the monitoring DB is provisioned in the Infra database module.
- Add **catalog `prisma migrate deploy`** (against `CATALOG_DATABASE_URL`) to the
  deploy sequence, ordered with checkin's own migration step.
- No new Caddy route, no new port, no new container — same app, new paths.

---

## 10. Testing

- **Unit/integration — keep vitest, port ~verbatim.** The source uses vitest,
  and so does **every checkin `packages/` package** (money, monitoring-db,
  pg-test-harness, s-ingest-core, telemetry all run `vitest`). `global-catalog`
  is a package, so it **keeps vitest** — its `src/__tests__/{unit,integration}`
  port with almost no change, run by the package's own `test` / `test:integration`
  scripts, reusing `@inventory/pg-test-harness`. **No jest conversion** (jest is
  checkin-app's convention, not the packages'). Wire the package's test scripts
  into the workspace test aggregation so CI runs them.
- **Security tests**: registry/stripper coverage for catalog routes lives in
  `checkin-app/src/security/__tests__` (jest — it tests checkin-app's boundary
  wiring). Companion to the boundary PR (track 3).
- **e2e = flow tests, not Playwright.** checkin has **no Playwright** and does
  end-to-end as **flow tests** (real HTTP journeys against a running dev server —
  `AGENTS.md`). So the source's Playwright specs (`auth`, `categories`, `items`,
  `proposals`, `role-access`, `error-states`) are **re-expressed as
  `flow-tests/*.flow.test.ts`**, not ported as Playwright — introducing
  Playwright would add tooling checkin deliberately doesn't have, and the catalog
  is API-route-driven for the first landing, so HTTP flow tests cover it well.
  These land **in track 5** (with routes + auth + UI), not deferred.
- **Browser-only UI assertions** (client-side form validation, modal behavior —
  the few things a flow test cannot assert): **not** covered by the above. If
  wanted, that is the *only* genuinely deferred test work — track it as a
  **follow-up issue referencing #1286**, not as vague "later." Default position:
  flow tests suffice; open the follow-up only if a real gap appears.

---

## 11. Phasing (PR tracks)

1. **Library skeleton** — `packages/global-catalog` (+ vendored `gtin`,
   `workflows`, temporary `receipt-types`), catalog schema + client + migrations,
   domain services/repositories/workflows ported, unit/integration tests. No UI,
   no checkin wiring. Green in isolation.
2. **Roles foundation** — add the `INVENTORY_MANAGER` `PersonRoleKind` value +
   roles.ts + next-auth types + grant UI. Own PR (role-system change).
3. **Security boundary** — `@sensitivity` annotations, second `generator
   security`, registry + scopeBindings entries. Own PR track, **registry-first**.
4. **Routes + auth** — library route-handler factories + `contract.ts` +
   `configureCatalog` wired in checkin-app `instrumentation.ts`; API stub tree +
   security guards. Depends on 1–3.
5. **UI + nav** — reskinned pages/components (in the library), page stub tree +
   `pageRegistry` entries, `catalogNav` splice, `transpilePackages`, flow test.
6. **Infra** — deploy sequence + DB provisioning.
7. **(Deferred — each a tracked follow-up issue vs #1286, not prose "later")**
   server-component conversion of hot pages; removal of temporary receipt shims
   when receipt-app migrates; browser-only UI test coverage if a gap appears
   (§10). File the follow-up issues at merge so nothing relies on memory.

---

## 12. Open items / assumptions

- **Production data: none, hand-entered.** There is no existing catalog data to
  migrate. Prod is populated **by hand through the UI**, row by row, from a
  Google Sheet. **No bulk-import endpoint or import script is built** — the
  source has none (items are created singly via `POST /api/{categories,
  subcategories,items}`), and none is wanted. Out of scope.
- **Dev/test seed — pull from `scripts/setup-test-data.sh`.** Inventory's
  `scripts/setup-test-data.sh` carries the baseline catalog rows (category
  `Electronics`/`N`, subcategory `Control System`/`10`, items `Roborio v2` +
  `Power Distribution Hub`, one item-reference). **Lift that data/shape**; drop
  its transport — the script drives the catalog over `curl` + the retired
  `/api/auth/login`, whereas the checkin seed writes **directly via the catalog
  Prisma client / library services** against `CATALOG_DATABASE_URL`. (The
  gc-app `src/__tests__/helpers/seed.ts` is auth-token seeding only — not
  reusable.) Add `VolunteerDesignation` rows too (seed currently has **0** —
  project memory) so the viewer gate and catalog pages are exercisable in dev
  and flow tests.
- **Deferral discipline.** Anything this design pushes past the first landing
  (track 7) becomes a **GitHub follow-up issue referencing #1286**, filed at
  merge — never a bare "later" in prose or a code comment. That is how we
  remember: the issue tracker, not this doc.

**Resolved in Q&A:** single `INVENTORY_MANAGER` role (managers collapsed); viewer
= any RBAC role / program leader / volunteer; catalog gets its **own dedicated
database** on the shared Postgres server (`CATALOG_DATABASE_URL`,
monitoring-db pattern) — no table renames needed.

---

*Design for #1286. Whole-Inventory migration context: this is the first app to
move; temporary duplication at receipt-app boundaries is expected and tracked.*
