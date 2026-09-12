# Org inventory: porting `local-inventory-app` into checkin

**Issue:** [#1287](https://github.com/innovationtreehouse/checkin/issues/1287)
— backlog item CI2 (PORT · NEEDS-DESIGN · L). Journey **A12** in
`docs/backlog/CUJS.md`.

**Status:** design. No board decision gates the mechanics below. This doc is the
**exact parallel** of the global-catalog design ([#1286](https://github.com/innovationtreehouse/checkin/issues/1286),
`docs/in-design/1286_GLOBAL_CATALOG_INTEGRATION.md`) and **reuses its base
architecture decisions verbatim** — read that doc first. Everything here is the
same shape applied to the org-inventory app, plus the two upstream couplings
that make local-inventory a *sink* rather than a leaf.

**Source:** `local-inventory-app/` in the `innovationtreehouse/Inventory` repo
(local: `/Volumes/Untitled/Inventory/local-inventory-app`). Not currently
deployed in Infra.

**Dependency:** local-inventory is **downstream of the global catalog** in the
E-PIPELINE (`receipt → workflow-mapping orchestrator → catalog + local-inventory`).
Its implementation **follows** #1286 — it consumes catalog org-events (§8) and
reuses the shared packages #1286 vendors (§2). Do not land local-inventory before
the catalog library exists.

---

## 1. Goal and shape

Bring org inventory into checkin as **more nav items in the existing checkin app
— one Next.js process, one Infra deploy** — not a second service. Identical to
the catalog decision (#1286 §1).

**The whole app — domain *and* UI — lands as an isolated library package**
(`@inventory/local-inventory`): services, repositories, workflows (xstate state
machines), Prisma schema/client, and every React component, page, and route
handler. `checkin-app` holds **only structural wiring, no inventory logic**:
filesystem-routing re-export stubs, one `configureLocalInventory()` boot call
that injects checkin's auth + DB, a nav splice, and the security-registry entries
(§5). The dependency arrow points one way — **the library never imports checkin;
checkin injects into the library.**

This is the **second app of the whole-Inventory migration** (catalog is first).
Where local-inventory touches Inventory apps that have not moved yet
(receipt-app, workflow-mapping-app), we bring **temporary copies / keep the HTTP
seam** exactly as #1286 §8 prescribes — temporary meaning **< 2 weeks, dev-only,
never in a release** — with a clean port at each crossing.

### Decisions locked (carried over from #1286, adapted)

| Question | Decision |
|---|---|
| DB topology | **Own dedicated database** (`LOCAL_INVENTORY_DATABASE_URL`) on the **same Postgres server** — separate `schema.prisma` + own Prisma client + own migrations. Same `@inventory/monitoring-db` precedent #1286 followed. The source already reads `LOCAL_INVENTORY_DATABASE_URL` (see `container.ts`), so the env-var name is inherited, not invented. |
| Security regime | **Adopt checkin's** registry + `@sensitivity` generator + stripper + scopeBindings over the separate schema (§5). |
| Auth | **Retire** `local-inventory-app`'s `@inventory/auth` + `@inventory/web-auth` (+ `bcrypt`/`jose`, the login page, `/api/auth/{login,logout,me}`). checkin next-auth session is the only auth. |
| Roles | **Reuse the `INVENTORY_MANAGER` role #1286 introduces** — the source's `organization_manager` (write) collapses into it. Viewer = the same broad gate #1286 defined. See §6. **No new role.** |
| Scope | **Full port** of the four A12 surfaces (§ below), with temporary shims at the not-yet-migrated receipt-app / workflow-mapping boundaries (§8). |
| UI location | **All UI in the library** — components, pages, route handlers. checkin-app only re-exports and mounts (§3). |
| UI style | **Keep the client pattern** — `"use client"` pages + `/api/*` routes; re-auth + re-theme only. Matches checkin's dominant pattern, same as #1286 §7. |
| `orgId` / user identity | **Keep the columns; inject the values** — resolved by #1286 §6. `orgId` is load-bearing (`Location.orgId`, `@@unique([orgId, gtin13])`, `ProvisionalResolution`'s org-scoped unique, every S4/S5 contract). Keep it. Org identity comes from a **checkin-owned `Org` registry table** (seeded on initial migration with a stable well-known id), injected as an **accessor** `org: getOrg(): OrgIdentity` — **not** an env scalar, **not** a `SettingsData` row, **not** a cross-DB read. User ids (`userId`/`proposedByUserId`/…) map to checkin **`Person.id`** via the injected principal. Both flow through the single `configureLocalInventory()` injection (§6). |

### The four A12 surfaces (scope)

1. **OrgItem + locations** — create / reassign locations; per-org item rows.
2. **Receive queue + fulfill** — delta-apply in/out per location/owner + an
   inventory log (audit of every quantity change).
3. **Inventory merge-conflict detection + resolution queue** — the exception
   screen (uom_mismatch parking; see §7, §8).
4. **Provisional-item resolution** — **consumes catalog org-events** (the S5
   coupling; §8).

---

## 2. What the source is

`local-inventory-app` is a Next 16 / React 19 / Mantine 7 / Prisma 7 app — the
**same stack checkin already runs**, and the same stack as `global-catalog-app`.
It is cleanly layered (DI container wires singletons):

```
src/
  lib/repositories/   inventory, location, orgEvents, provisionalItem,
                      provisionalResolution, receiveQueue                (Prisma access)
  lib/services/       inventory, location, orgSettings, provisionalItem,
                      receipt, receiveQueue, user, serviceError          (domain logic)
  workflows/          xstate machines: provisional-item, merge-conflict,
                      received-org-event                                 (lifecycle guards)
  lib/                gtin, container (DI), org-events-poller, api-client (portable)
                      auth, auth-shared, route-auth                      (RETIRE — see §6)
  app/api/…           route handlers (thin: guard → validate → service → response)
  app/(app)/…         page.tsx (client) per surface
  components/         AppShell, AuthProvider, MantineProvider            (reskin/retire)
prisma/schema.prisma  14 models (own migrations)
```

**Prisma models** (own schema, `@@map` to snake_case tables): `Location`,
`OrgItem`, `InventoryLog`, `ReceiveQueue`, `SettingsData`, `ProvisionalItem`,
`InventoryMergeConflict`, `ProvisionalResolution`, `ReceivedOrgEvent`,
`ProvisionalItemLog`, `ReceivedInventoryDelta`, `LocationLog`. (12 declared;
plus the two Prisma-generated join/relation surfaces on `Location`↔`OrgItem`.)

The domain layer is framework-light and ports almost verbatim. The friction is
**auth wiring and the two upstream couplings** (§8), not the domain.

### Workspace dependencies — reuse #1286's vendored packages, add two

The source depends on `@inventory/{auth, web-auth, gtin, workflows, receipt-types,
receipt-contract-fixtures, org-events-poller, utils, pg-test-harness}`.
Disposition — **the catalog port (#1286) already vendors `gtin`, `workflows`,
`receipt-types`, `receipt-contract-fixtures`; local-inventory REUSES those, does
not re-vendor.** New to local-inventory: `org-events-poller` (the consumer side —
catalog is a *producer* and never needed it) and `utils`.

| Source package | Ported? | Action |
|---|---|---|
| `@inventory/auth`, `@inventory/web-auth` | **No — dropped** | The source's auth system, retired for checkin next-auth (§6). |
| `@inventory/gtin` | Reuse | Already `packages/gtin` (vendored by #1286). No second copy. |
| `@inventory/workflows` | Reuse | Already `packages/workflows` (vendored by #1286). Shared xstate helpers. |
| `@inventory/receipt-types`, `receipt-contract-fixtures` | Reuse (temporary) | Already vendored by #1286 as temporary copies — local-inventory imports the same copy. Endgame: the permanent shared contract when receipt-app lands. |
| `@inventory/org-events-poller` | **Yes — new `packages/org-events-poller`** | Shared S5 outbox-consumer machinery (cursor, ledger write, `assertTransition`, `onEvent` dispatch). Consumed by local-inventory/expense/workflow-mapping — a cross-app utility, **standalone package**, not folded into `local-inventory`. **Drive its drain from the in-process signal + boot, not its `setInterval`** (§8a) — expose/extract a one-shot `drainOnce` if the package only ships the timer-start today; the wall-clock loop is not used in checkin. |
| `@inventory/utils` | **Yes — new `packages/utils`** (or reuse if #1286 already needed it) | Generic helpers. Standalone shared package; check whether #1286 already vendored it before adding a second copy. |
| `@inventory/pg-test-harness` | n/a | Already present in checkin. Reuse. |

Only genuinely inventory-specific helpers (`lib/gtin.ts` is a thin re-export;
`api-client.ts`, `container.ts`, `org-events-poller.ts` wiring) live inside
`local-inventory/src/lib`.

---

## 3. Target layout — the meat lives in the library

**Goal: a developer working on org inventory works entirely inside
`packages/local-inventory`.** Same cut #1286 §3 established.

```
checkin/
  packages/
    local-inventory/                      ← the whole app, as a library
      src/
        repositories/  services/  workflows/  lib/       domain (ported verbatim)
        prisma/schema.prisma  prisma/migrations/  generated/   separate schema+client
        components/                        ALL inventory UI (Mantine, reskinned)
        pages/                             page components — client
        routes/                            route-handler factories (GET/POST/…)
        nav.ts                             exported nav manifest (inventoryNav: NavItem[])
        runtime.ts                         configureLocalInventory() + getPrincipal()/db/org accessors
        contract.ts                        InventoryAuth / InventoryPrincipal / OrgIdentity + crossing ports (§8)
      package.json
    org-events-poller/  utils/            new vendored @inventory/* deps
    gtin/  workflows/  receipt-types/     REUSED — vendored by #1286
  checkin-app/                            ← WIRING ONLY, no inventory logic
    src/instrumentation.ts                + one configureLocalInventory({...}) call at boot
    src/app/(inventory)/**/{page,route}.tsx  re-export stubs
    src/lib/nav*                          splice in `inventoryNav` from the library
    src/security/{registry,scopeBindings}.ts   + inventory entries (boundary is checkin's)
    next.config.ts                        + transpilePackages: ['@inventory/local-inventory', …]
```

### The cut — same as #1286

Next's App Router discovers routes by **filesystem**, so ~23 route handlers +
8 page files must physically sit under `checkin-app/src/app`. Each is a
**one-line re-export** of a library module:

```ts
// checkin-app/src/app/(inventory)/inventory/org-inventory/page.tsx
export { default } from '@inventory/local-inventory/pages/org-inventory'

// checkin-app/src/app/(inventory)/api/inventory/receive-queue/route.ts
export { GET, POST } from '@inventory/local-inventory/routes/receive-queue'
```

**Auth + DB + org injection without the library importing checkin:** the library
declares interfaces in `contract.ts` (`InventoryPrincipal`, `InventoryAuth` with
`getPrincipal()` / `requireManager()` / `isViewer()`, `OrgIdentity = { id, name }`
behind an accessor `getOrg(): OrgIdentity`), plus the crossing **ports** (§8).
checkin-app calls `configureLocalInventory({ auth, db, org, catalogEvents })`
**once** in `instrumentation.ts` — the one justified boot singleton, mirroring
`configureCatalog()`. The `org` accessor is backed by **checkin's `Org` registry
table** (§6) — never a `SettingsData` row, never a cross-DB read.

**Honest residue** — same three mechanical things that structurally cannot leave
checkin-app: (1) the FS-routing stub files; (2) their `pageRegistry` entries
(checkin's drift guard — project memory); (3) the security registry/scopeBindings
entries (checkin centralizes the boundary on purpose). Adding a *new* inventory
route touches all three; editing inventory behavior touches none.

**One extra boot concern local-inventory has that catalog does not:** the source
`container.ts` **starts a time-based org-events poller on import** (guarded by
`LOCAL_INVENTORY_DATABASE_URL` being set, so `next build` doesn't connect). checkin
**drops the interval poller entirely** — an in-app `setInterval` would keep the
container's event loop awake forever and fight clean shutdown. Instead the S5
consumer is **push-driven** (§8a): a one-shot **boot catch-up drain** from
`configureLocalInventory()` / `instrumentation.ts` (server runtime only, never a
container-import side effect, never during `next build`), plus **drain-on-emit**
signalled in-process by catalog's producer. No wall-clock timer. Land it **inert**
until the catalog producer emits (§8, §11).

---

## 4. Database — its own database on the shared server

Own dedicated database (`LOCAL_INVENTORY_DATABASE_URL`) on the same Postgres
server as checkin — separate `schema.prisma`, separate Prisma client, own
migration history. Identical rationale and precedent to #1286 §4
(`@inventory/monitoring-db`). A dedicated DB namespaces the generic tables
(`org_items`, `locations`, `inventory_log`, …) so **no model/table renames** are
needed.

Implications (same as #1286 §4, plus):

- **Three Prisma clients** now load in the checkin-app process (catalog +
  local-inventory + checkin), each its own connection string / pool.
- **No cross-database SQL.** local-inventory ↔ catalog ↔ checkin crossings are
  service-level (§8), never SQL joins. The S5 consumer reads catalog's OrgEvent
  rows via the catalog **service/port**, not a cross-DB join.
- **Migrations run independently** — add a `migrate deploy` step against
  `LOCAL_INVENTORY_DATABASE_URL` to the deploy sequence (§9).
- **`db push` caveat** (project memory): the source relies on partial-unique and
  `@@unique` constraints; use `migrate deploy`, not `db push`, for any DB the
  P2002/uniqueness tests run against. The source already ships six ordered
  migrations under `prisma/migrations/` — port them as-is.

---

## 5. Adopting checkin's security regime over a separate schema

Same mechanism as #1286 §5 (a second/third `generator security` block emitting a
`local-inventory-classifications.ts`, merged in the security core; registry +
scopeBindings entries; responses through checkin's stripper).

**Field tiering** — inventory reference/quantity data is largely operational, not
personal. The schema has **no email/DOB/address fields → no `pii` tier**.

- **`public` / `internal` (operational):** `gtin13`, quantities
  (`existingQuantity`, `desiredQuantity`, `quantity`), `Location.name`,
  location assignments, conversion factors/versions, statuses, `changeType`,
  `eventType`. On-hand quantity and locations are posted operationally in the
  building — treat as `public`/`internal`, not sensitive (matches the
  cert-status-public-by-design posture; project memory). **`orgId`** is an
  org-scoping token, `internal`.
- **`internal` — actor attribution:** `userId`, `username`, `proposedByUserId`,
  `resolvedByUserId`, `performedBy`, `performedByUsername` (who did what).
- **`internal` — free text:** `rejectionReason`, `failureReason`, `notes`,
  `resolution` (may carry incidental sensitive text).
- **`internal` — cross-app plumbing:** `receiptId`, `ReceivedOrgEvent.payload`,
  `ReceivedInventoryDelta.deltaJson`, `sourceEventId`, `lineItemId`.

**Boundary-isolation process applies** (`AGENTS.md` + the
`security-boundary-isolation` workflow): registry / scopeBindings / generator
changes ship in their **own PR(s)**, ahead of the route code — **registry-first**
(an unused `defineRoute` is inert). This is the most process-heavy part; plan it
as its own PR track (§11).

**Route inventory to register** (~13 registry entries, one per verb×route family):
`locations` (GET/POST) + `locations/[id]` (PATCH/DELETE) + `locations/[id]/reassign`
(POST); `org-items` (GET) + `org-items/[gtin13]` (PATCH); `receive-queue` (GET) +
`receive-queue/[id]` + `.../fulfill` (POST); `inventory/apply` (POST);
`inventory-log` (GET); `inventory-merge-conflicts` (GET) +
`.../[id]/resolve` (POST); `provisional-items` (GET/POST);
`received-inventory-deltas` (GET); `received-org-events` (GET); `system-data`
(GET); `global-catalog/items*` (read-through — see §8). The `/api/internal/*`
and `/api/inventory/apply` **inbound** surfaces are the machine-to-machine seam
(§8) — registered with a service/bearer token grant, not the viewer gate.

---

## 6. Auth and roles

**Retire the source auth entirely.** Delete `lib/auth.ts`, `auth-shared.ts`,
`route-auth.ts` (except the pieces re-expressed below), `LoginForm`/`login` page,
`AuthProvider`, and `/api/auth/{login,logout,me}`. checkin already owns login and
session.

Every route/page guard is re-expressed against the checkin session. The source's
guards map cleanly:

| Source guard | checkin |
|---|---|
| `canEditOrg(user, orgId)` (writes: fulfill, apply, reassign, resolve, org-item edit) | **`INVENTORY_MANAGER`** (the role #1286 adds — reuse, no new role) |
| `canViewOrg(user, orgId)` (reads: queues, lists, logs) | **the viewer gate #1286 defined** — authenticated **and** any RBAC-role holder / program leader / volunteer |
| `requireOrgBearer` (`/api/inventory/apply`, S3 delta from orchestrator) | checkin's **org-bearer / internal token** — the inbound machine seam (§8) |
| `requireServiceKey` (`X-Service-Key`, `/api/internal/*` from receipt/orchestrator) | checkin's **internal service-key** grant — the inbound machine seam (§8) |

**No role-foundation change is needed for local-inventory** — `INVENTORY_MANAGER`
already lands in #1286's track 2. This doc's implementation simply *depends on*
that role existing. Define a thin `isInventoryViewer(session)` predicate (same
composition as #1286's `isCatalogViewer`) as the single read chokepoint, or reuse
`isCatalogViewer` directly if the eligibility sets are identical (they are — both
are "any legitimate operational user reads; managers write"). **Prefer reusing
the one predicate** over a near-duplicate.

### Org + user identity — one injected source, shared with catalog

Resolved by #1286 §6 — local-inventory **adopts the same decision, not a
variant**. The source's `orgId` came from the org-bearer token and the acting
user from the auth-server cookie; **both are retired**, and checkin has no `orgId`
concept (it *is* Treehouse). So:

- **Org identity from a checkin-owned `Org` registry table** — not an env scalar.
  checkin-app hosts the one process, so the `Org` table (`{ id, name, … }`) lives
  in **checkin's schema**; the Treehouse row is **seeded on the initial
  migration with a stable, well-known id** (deterministic across dev/prod so the
  stamped `org_id`s match everywhere). #1286 introduces and seeds this table —
  **local-inventory adds nothing here**, it only receives the injected accessor.
- **Injected as an accessor**, `org: getOrg(): OrgIdentity`, into
  `configureLocalInventory()`. Single-org returns the one seeded row; a future
  multi-org resolves the current org per request (session / tenant / route) —
  **same seam, no library change**. **No library reaches cross-DB into checkin's
  `Org` table** — checkin-app reads its own table and injects, so consistency is
  by injection, not shared reads. local-inventory and catalog receive the **same**
  injected id (required — §8's S5 events and `@@unique([orgId, gtin13])` line up
  across the two DBs only if the value is identical).
- **Keep `org_id`/`org_name` columns** (String) — they already match a registry
  id; single-org stamps every row with the one seeded org, multi-org fills them
  from the resolved accessor.
- **User ids → checkin `Person.id`**, supplied by the injected
  `InventoryPrincipal` (`getPrincipal()`), not a users table (the source's
  local-users table is gone with its auth). Attribution columns (`userId`,
  `username`, `proposedByUserId`, `resolvedByUserId`, `performedBy`,
  `performedByUsername`) store the injected principal's id + a username snapshot;
  no FK to checkin (separate DB).

Both org and user identity flow through the single `configureLocalInventory()`
injection — one source per process.

---

## 7. UI — reskin in place

All UI lives in the library (`packages/local-inventory/src/{components,pages}`);
checkin-app only re-exports pages (§3) and splices `inventoryNav`. Same Mantine
version → component-level reskin, not a rewrite. **Keep the source's
`"use client"` + `/api/*` pattern** (matches checkin; #1286 §7).

Eight pages, each an A12 surface / exception screen:

- `org-inventory` — OrgItem list + quantity edit (surface 1/2).
- `locations` — create / rename / reassign (surface 1); backed by `LocationLog`.
- `receive-queue` — pending receipts, fulfill action (surface 2).
- `received-inventory-deltas` — applied S3 deltas + failures (surface 2 audit).
- `inventory-merge-conflicts` **exception screen** — uom_mismatch resolution
  queue (surface 3).
- `provisional-part-map` / `provisional-items` — provisional resolution view
  (surface 4).
- `org-events` — the polled catalog org-events ledger (surface 4;
  `received-org-events`). **local-inventory is the org-facing consumer that
  surfaces these** — workflow-mapping deliberately does not (BYDESIGN, §10).
- `system-data` — settings (`SettingsData`: poll interval/window, global server
  URL). Poll-config only — **org identity is not here** (it comes from the injected
  `Org` accessor, §6).
  These poll fields are **dead on arrival**: the S5 crossing is in-process and
  push-driven from day one (§8a), so there is no timer to configure. Keep the row
  (harmless, and the model ports cleaner intact); drop the fields with the
  track-8 cleanup rather than wiring UI to them.

Drop the source `AppShell`/nav shell; pages render inside checkin's shell. Wire
auth via `useSession` client-side + the checkin session in the route handlers.

---

## 8. Upstream couplings — the two crossings that make local-inventory a sink

local-inventory is a **terminal SINK** in the E-PIPELINE. Two upstream couplings
must be designed explicitly, using the **same per-crossing rule #1286 §8 set**:
*keep the JSON/contract shapes; convert transport, not architecture; every
crossing sits behind a port with an `http` adapter (today) and an `in-process`
adapter (after co-residence); converting a crossing = swap one adapter binding in
`configureLocalInventory()`, zero call-site churn; trigger = co-residence.*

### Crossing archetypes (from the source)

| Crossing | Direction | Kind | Contract | Today's transport |
|---|---|---|---|---|
| **S5 org-events** — provisional resolution events (`provisional_approved` / `_rejected` / `_mapped_to_existing`) | **catalog → local-inventory** | **async outbox — consumer side** | shared S5 union (`parseOrgEvent`, `@inventory/receipt-types`) | catalog's OrgEvent table, **HTTP-polled** by `startOrgEventsPoller`, persisted to local `received_org_events`, reacted to via `provisionalItemService` |
| **S3 delta-apply + provisional/enqueue** — `inventory/apply`, `provisional-items`, `receive-queue`, `GET org-items` | **workflow-mapping orchestrator → local-inventory** | **synchronous RPC — callee side** | `ResolvedInventoryDeltaSchema` (org-bearer) + the `/api/internal/*` zod schemas (service-key) | `POST /api/inventory/apply` (org-bearer) and `POST/GET /api/internal/[...path]` (X-Service-Key) |

These convert **differently** — that is the whole point of deciding now.

### 8a. catalog → local-inventory (S5, item #4 — provisional resolution)

**This is async and stays async** (#1286 §8 rule 4). The outbox — durable events,
in-transaction write on the catalog side, retry/ordering/audit, and
local-inventory's own `received_org_events` ledger + `received-org-event` xstate
machine — has value independent of transport. The consumer reacts by calling
`provisionalItemService.{approveProvisional,rejectProvisional,mapProvisionalToExisting}`,
which does the org-item merge and **parks a `uom_mismatch` `InventoryMergeConflict`**
when the provisional's counted conversion factor ≠ the resolved real item's factor
(surface 3, the exception screen — see `mergeOrgItems`).

**Conversion at co-residence — and why there is no in-app timer.** catalog lands
first (#1286), so it is co-resident from local-inventory's **first day**. There is
therefore **no remote producer to poll** — and the source's time-based
`setInterval` poller must **not** be carried across. An in-app interval poller
would keep the Node event loop busy forever (never-idle container), wake every N
minutes with no traffic, duplicate-poll across replicas, and fight a clean
SIGTERM. The async seam stays; the **trigger** changes from "poll on a timer" to
"drain on an in-process signal." Concretely the in-process adapter is:

- **Boot catch-up drain** — one-shot on startup: drain any `OrgEvent` rows written
  while this process was down (crash recovery). No timer.
- **Drain-on-emit** — catalog's `emitOrgEvent`, **after it commits** the
  `OrgEvent` row, fires an in-process signal through the injected port; the
  consumer drains **all pending rows for that org** (not just the just-written
  one — so a sibling replica's writes are swept too). No timer.
- **Bounded per-row retry** on a failed drain (backoff on the row); a stuck row is
  re-attempted by the next emit-drain. **No periodic sweep** — events keep
  arriving, so the next emit is the retry clock. Add a long-interval safety sweep
  **only** if a real stuck-row gap appears, and if so run it on checkin's
  **external scheduler** (the existing cron/Lambda infra), never an in-app
  `setInterval` — so the container is still poked from outside, not self-woken.

Everything durable stays: the `OrgEvent` outbox rows, local `received_org_events`
ledger, ordering, and the `assertTransition` guard. Only the wall-clock timer is
gone.

- Keep the shared S5 union (`parseOrgEvent`) as the contract in both modes.
- The `http`/poll adapter exists in the port **only** as the fallback shape for a
  *remote* producer. Since catalog is co-resident from day one, **local-inventory
  ships the in-process push adapter and never ships an in-app interval poller.**
  Land the consumer **inert** (drain wired but the catalog producer not yet
  emitting) until catalog actually emits, per #1286 §8's inert-consumer note.

**Port shape** (`contract.ts`): `CatalogEventSource` with `drainPending(orgId)`
(sweep + apply) plus a `subscribe(onEmit)` the producer calls post-commit; the
`in-process` adapter binds `onEmit` to catalog's emit hook, and `drainPending`
reads catalog's OrgEvent rows via the catalog library service (both DBs in one
process — a direct call into `@inventory/global-catalog`, not a cross-DB join).
The retained `pollSince(cursor)` shape is the remote/`http` fallback only.
local-inventory imports the port, never `@inventory/global-catalog` directly —
checkin injects the bound adapter and, in `configureLocalInventory()`, runs the
boot drain.

**Preserve these BYDESIGN behaviors** (do not "fix" in the port):
- `conversion_challenge_*` events are **not** consumed / not back-propagated
  (forward-only shrinkflation semantics; BYDESIGN). The poller's `default: break`
  stays.
- Provisional-approval quantity imprecision (UNFINISHED #5): a provisional's
  stock counted at factor 1 vs. the real item's canonical factor is reconciled by
  the **uom_mismatch merge-conflict path**, not by silent rescaling. Keep it.

### 8b. workflow-mapping orchestrator → local-inventory (S3, apply surface)

**This is synchronous RPC, and local-inventory is the callee.** The orchestrator
(CI4, #1289 — **out of scope here**; only its calls *into* local-inventory are in
scope) drives the "apply / retry-apply / proceed" surface. local-inventory
**exposes** it. The contract local-inventory must preserve:

| Operation | Today's route | Payload contract | checkin auth |
|---|---|---|---|
| **apply / retry-apply delta** | `POST /api/inventory/apply` | `ResolvedInventoryDeltaSchema` (`orgId`, `receiptId`, `retailer?`, `lineItems[]` with `gtin13`, `quantityDelta`, `isDelayed`, `lineItemId`, `isProvisional`, `provisionalName`, `conversionFactor`, `conversionVersion`) | org-bearer |
| **apply (service variant)** | `POST /api/internal/inventory/apply` | `ApplyInventorySchema` (items[]) | X-Service-Key |
| **create provisional** | `POST /api/internal/provisional-items` | `ProvisionalItemSchema` | X-Service-Key |
| **enqueue receive** | `POST /api/internal/receive-queue` | `ReceiveQueueSchema` | X-Service-Key |
| **read org-item** | `GET /api/internal/inventory/org-items/:gtin13?orgId=` | — | X-Service-Key |

**Idempotency is part of the contract, not an implementation detail.** `apply`
upserts `ReceivedInventoryDelta` keyed on `receiptId` and re-applies — a re-push
of the same `receiptId` is a safe retry (that is *why* the orchestrator can
"retry-apply"). Preserve this exact idempotent shape when the transport flips.

**Conversion at co-residence:** when workflow-mapping migrates (CI4), bind the
**in-process** adapter — the orchestrator imports `receiptService.applyReceipt` /
`enqueueItem` / `createProvisional` **directly via the port** instead of the HTTP
stub. Keep the zod schemas as the function param types. **Retire the
`/api/internal/*` route + org-bearer `/api/inventory/apply` LAST** — during the
overlap window a still-remote receipt-app / workflow-mapping may still call them.
**Do not assume workflow-mapping "collapses away"** — only its transport changes;
its calls into local-inventory are real and must stay behind the port.

**Known concurrency hazard to carry across** (CONCURRENCY.md #2): concurrent
`fulfill` of one receive-queue item, and concurrent `apply` of one receipt, have
an unverified read-check-then-write race. The idempotency upsert covers the
sequential replay; the concurrent window is not proven closed. Track as a
**follow-up issue vs #1287** with a concurrent-drive test — do not silently
"fix" during the port (BYDESIGN discipline: write the failing concurrent test
first).

### First landing (local-inventory in; catalog in, receipt/orchestrator not yet)

- Reuse the temporary vendored `receipt-types` / `receipt-contract-fixtures`
  (#1286's copies).
- **S5 consumer**: bind the in-process catalog-events adapter but land the poller
  **inert** (flag-gated) until catalog emits provisional events; the local ledger
  + merge-conflict path are exercisable via seeded events / the catalog's own
  manual resolution routes.
- **S3 apply surface**: keep the HTTP `/api/inventory/apply` + `/api/internal/*`
  routes **live** (checkin org-bearer / service-key) so a still-remote
  receipt-app / workflow-mapping can drive apply during the overlap. They flip to
  in-process per the rule when those apps co-reside; retire last.

All temporary duplication is **< 2 weeks, dev-only** — acceptable, tracked.

---

## 9. Infra / deploy

Adds **no new service** — compiles into `checkin-app`'s build, ships in checkin's
existing container. Same as #1286 §9, plus:

- Build the new `packages/*` (`local-inventory`, `org-events-poller`, `utils`);
  the workspace build already covers `packages/*`.
- **Provision the dedicated inventory database** + `LOCAL_INVENTORY_DATABASE_URL`
  secret (monitoring-db pattern in the Infra database module).
- **Org registry** — the checkin-owned `Org` table + its seeded Treehouse row
  (stable id) are **#1286's** deploy artifact (§6); already present once catalog
  lands. local-inventory adds no env and no seed here — it receives the injected
  `org` accessor at boot.
- Add **inventory `prisma migrate deploy`** (against `LOCAL_INVENTORY_DATABASE_URL`)
  to the deploy sequence, ordered with checkin's and catalog's migration steps.
- **S5 consumer lifecycle**: **no background timer** (§8a). A one-shot boot
  catch-up drain runs from `instrumentation.ts` / `configureLocalInventory()` in
  the server runtime only (never during `next build`); thereafter the consumer is
  woken by catalog's in-process emit signal. Nothing keeps the event loop awake
  between events, so idle CPU is zero and SIGTERM is clean. Safe under N replicas
  (each boot-drains; drain-on-emit sweeps all pending rows for the org).
- No new Caddy route, no new port, no new container.

---

## 10. Testing

Same posture as #1286 §10:

- **Unit/integration — keep vitest, port ~verbatim.** `local-inventory` is a
  `packages/` package → keeps vitest (jest is checkin-app's convention, not the
  packages'). Its `src/__tests__/{unit,api,components}` port with little change,
  reusing `@inventory/pg-test-harness`. Wire the package's `test` /
  `test:integration` scripts into the workspace test aggregation.
- **Security tests**: registry/stripper coverage for inventory routes lives in
  `checkin-app/src/security/__tests__` (jest — checkin-app boundary wiring).
  Companion to the boundary PR (track 3).
- **e2e = flow tests, not Playwright.** checkin has no Playwright; the source's
  Playwright specs (`e2e/`) are **re-expressed as `flow-tests/*.flow.test.ts`** —
  real HTTP journeys against a running dev server. Priority journey: **A12 end to
  end** — enqueue → fulfill → apply delta → provisional resolution → uom_mismatch
  merge-conflict → resolve. Land in track 5.
- **Coupling tests**: the two ports (§8) get contract tests on both adapters
  (`http` and `in-process` produce identical results for the same input) —
  the cheapest guard that a transport flip is behavior-preserving.
- **Concurrency**: the CONCURRENCY.md #2 fulfill/apply race is a **tracked
  follow-up** (§8b), not blocking the port.

---

## 11. Phasing (PR tracks)

**Dependency gate:** local-inventory implementation **follows the global-catalog
library (#1286)** — catalog is the upstream producer of the S5 events
local-inventory consumes, and local-inventory reuses catalog's vendored packages
(§2). Track 1 below can start once #1286 track 1 (catalog library skeleton +
`packages/gtin,workflows,receipt-types`) has landed.

1. **Library skeleton** — `packages/local-inventory` (+ new `packages/org-events-poller`,
   `packages/utils`), inventory schema + client + migrations (port the six),
   domain services/repositories/workflows ported, unit/integration tests. No UI,
   no checkin wiring. Green in isolation.
2. **Roles** — **none new**; depends on #1286 track 2 having landed
   `INVENTORY_MANAGER`. Define `isInventoryViewer` (or reuse `isCatalogViewer`).
   No separate PR unless the viewer predicate diverges.
3. **Security boundary** — `@sensitivity` annotations, `generator security` for
   the inventory schema, registry + scopeBindings entries. Own PR track,
   **registry-first**.
4. **Routes + auth + inbound seam** — library route-handler factories +
   `contract.ts` (incl. the two crossing ports) + `configureLocalInventory`
   wired in checkin-app `instrumentation.ts`; API stub tree + security guards;
   the `/api/internal/*` + `/api/inventory/apply` inbound surface with the
   `http` adapter live. Depends on 1–3.
5. **UI + nav** — reskinned pages/components (in the library), page stub tree +
   `pageRegistry` entries, `inventoryNav` splice, `transpilePackages`, A12 flow
   test.
6. **S5 consumer** — bind the in-process catalog-events adapter (push-driven, §8a:
   boot drain + drain-on-emit, **no timer**); wired from `instrumentation.ts`,
   inert until catalog emits. Requires #1286's `emitOrgEvent` to expose the
   post-commit signal hook the consumer subscribes to. Depends on 1–4 and on
   #1286's catalog producer being co-resident.
7. **Infra** — deploy sequence + DB provisioning.
8. **(Deferred — each a tracked follow-up issue vs #1287, not prose "later")**
   retire the HTTP `http`-adapter routes when receipt-app / workflow-mapping
   co-reside and flip to in-process; the concurrency #2 fulfill/apply race test +
   fix; UNFINISHED #5 provisional-quantity auto-correction (currently the
   uom_mismatch queue is the accepted interim). File these at merge.

---

## 12. Open items / assumptions

- **`orgId` value — RESOLVED by #1286 §6** (was this doc's one open question).
  Org identity is a **checkin-owned `Org` registry row** (seeded on the initial
  migration with a stable well-known id), injected into `configureLocalInventory()`
  as an accessor `getOrg()` — not an env scalar, not a `SettingsData` row, no
  cross-DB read. checkin-app injects the **same** id into catalog and
  local-inventory, so the two apps' `orgId` agree by construction (required for the
  S5 events and cross-DB uniques to line up). Multi-org later = more rows + a
  per-request accessor, no library change. Columns kept. **No STOP-AND-ASK
  remains.**
- **Production data: none to migrate.** The source populates org inventory by
  running the pipeline (receive → apply) or manual UI edits; there is no bulk
  import to build, and none is wanted. Out of scope.
- **Dev/test seed — lift from `scripts/setup-test-data.sh`** (Inventory monorepo),
  the same script #1286 §12 draws catalog rows from. It seeds locations, org-items,
  and a receive-queue entry over `curl` + the retired `/api/auth/login`; **lift
  the data/shape, drop the transport** — the checkin seed writes directly via the
  inventory library services / Prisma client against `LOCAL_INVENTORY_DATABASE_URL`.
  Add `VolunteerDesignation` rows (project memory: seed has 0) so the viewer gate
  and inventory pages are exercisable in dev and flow tests. Both seeds stamp rows
  with the same seeded `Org` id (§6) and must agree on the GTINs a provisional
  resolves to (so the S5 merge path is exercisable end-to-end).
- **No in-app S5 timer** (§8a) — the consumer is push-driven (boot drain +
  drain-on-emit), so nothing keeps the container awake. This requires **#1286's
  `emitOrgEvent` to expose a post-commit signal hook** the consumer subscribes to
  via the injected port — a coordination point with the catalog design; if #1286
  ships without that hook, add it there (its own PR) before track 6. `SettingsData`
  poll fields (`pollIntervalMinutes` / `globalServerUrl`) are dead on arrival;
  drop them with the track-8 cleanup.
- **Deferral discipline.** Anything past the first landing (track 8) is a
  **GitHub follow-up issue referencing #1287**, filed at merge — never a bare
  "later" in prose or a code comment.

**Resolved by reuse of #1286:** own dedicated database
(`LOCAL_INVENTORY_DATABASE_URL`); checkin security regime over a separate schema;
retire source auth for checkin next-auth; `INVENTORY_MANAGER` for writes + broad
viewer gate for reads (no new role); org+user identity from a checkin-owned `Org`
registry row (seeded, stable id) injected as an accessor through
`configureLocalInventory()` — not env, not a settings row, not cross-DB;
keep-JSON-contracts / convert-transport crossing rule; vitest + flow-tests
(no Playwright); no table renames.
**Left open:** nothing blocking — only the tracked deferrals (§11 track 8).

---

*Design for #1287. Second app of the whole-Inventory migration; downstream of the
global catalog (#1286), which must land first. Temporary duplication at the
receipt-app / workflow-mapping boundaries is expected and tracked.*
