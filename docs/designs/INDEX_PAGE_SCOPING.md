# "Index" — Searchable Page Directory: Scoping Document

**Status:** MVP shipped (`/index` + `src/components/pageRegistry.ts` + the drift-guard test). This is the scoping record — decisions, route inventory, and the deferred/roadmap items below.
**Date:** 2026-06-29
**Purpose:** Give every signed-in user a single page that lists *every app page they are allowed to reach*, with a search box to filter, so they can jump anywhere without hunting through the sidebar. Sits in the nav directly **below "Settings"**.

---

## 1. Current State (what is true today)

### Navigation today
- **Sidebar** (`checkin-app/src/components/AppFrame.tsx`, `NAV_ITEMS` L61–123): 12 hard-coded top-level items, each with a `visible(user, signedIn)` predicate. Rendered at L305 (`visibleItems.map`). Badges via `navBadgeFor()` (L135) off `useTodoCounts`.
- The sidebar **only lists top-level sections**. Sub-pages (e.g. `/membership-ops/participants`, `/system-status/audit-log`, `/settings/roles`) are reachable but invisible until you drill into the section. ~60 page routes exist; only 12 show in nav.
- **No command palette, no site map, no search-to-navigate** anywhere in the app (confirmed by sweep).

### How routes are role-gated (the key mechanism the Index must reuse)
Two layers, already in place — the Index must **read** them, never re-implement:

1. **Top-level visibility** lives in `NAV_ITEMS[].visible`. Examples:
   - `/my-household`, `/my-activities`, `/attendance` → any signed-in user.
   - `/programs` → everyone (public).
   - `/shop-ops` → `sysadmin || boardMember || toolStatuses.some(level === 'MAY_CERTIFY_OTHERS')`.
   - `/facility-ops`, `/membership-ops`, `/membership-audit`, `/program-ops`, `/finance-ops`, `/system-status`, `/settings` → `sysadmin || boardMember`.
   - `/safety` → `sysadmin || boardMember || keyholder`.
2. **Section enforcement** lives in each section's `layout.tsx` via `useRequireRole([...])`. Confirmed gates:
   - `facility-ops`, `finance-ops`, `membership-ops`, `membership-audit`, `system-status` → `["sysadmin","boardMember"]`.
   - `safety` → `["sysadmin","boardMember","keyholder"]`.
   - `program-ops` → `["sysadmin","boardMember"]`.
   - `shop-ops` → cert-aware (matches its `NAV_ITEMS` predicate).
   - `settings` (`settings/layout.tsx`) → `sysadmin || boardMember`.
   - `my-activities`, `my-household` → signed-in.

**Governing fact:** a sub-page inherits its section's gate. `/system-status/audit-log` is reachable iff `/system-status` is. So the Index does **not** need a per-route permission table — it needs a per-route → **section** mapping, then reuses the section's existing predicate. One source of truth.

### Session user shape
`types/next-auth.d.ts`: `sysadmin, boardMember, keyholder, backgroundCheckReviewer, householdLead, toolStatuses[]`. Same object `NAV_ITEMS[].visible` already consumes (`SessionUser` type, AppFrame L47–52).

---

## 2. The full route inventory (every `page.tsx`, grouped by section)

Scope chosen: **every route, role-filtered**. ~60 routes today. Dynamic routes (`[id]`) are detail pages with no stable label — **excluded** from the Index (you reach them from a list, not by name). Listing below is the candidate registry content.

| Section (gate) | Routes to list |
|---|---|
| **(signed-in)** | `/my-household`, `/my-activities`, `/my-activities/events`, `/my-activities/programs`, `/profile`, `/attendance`, `/attendance/manual`, `/attendance/certifications` |
| **(public)** | `/programs`, `/` (home) |
| **safety** `[sa,bm,kh]` | `/safety`, `/safety/board-contacts`, `/safety/emergency-contacts`, `/safety/pickup`, `/safety/trusted-adults` |
| **shop-ops** `[cert]` | `/shop-ops`, `/shop-ops/create`, `/shop-ops/live`, `/shop-ops/manage` |
| **facility-ops** `[sa,bm]` | `/facility-ops`, `/facility-ops/badges`, `/facility-ops/print-badges`, `/facility-ops/trends`, `/facility-ops/visits` |
| **membership-ops** `[sa,bm]` | `/membership-ops`, `/membership-ops/applications`, `/membership-ops/households`, `/membership-ops/participants`, `/membership-ops/participants/new`, `/membership-ops/participants/import`, `/membership-ops/participants/merge`, `/membership-ops/review` |
| **membership-audit** `[sa,bm]` | `/membership-audit`, `/membership-audit/emergency-contacts`, `/membership-audit/unclaimed` |
| **program-ops** `[sa,bm]` | `/program-ops`, `/program-ops/programs`, `/program-ops/events`, `/program-ops/new`, `/program-ops/sessions`, `/program-ops/sessions/new` |
| **finance-ops** `[sa,bm]` | `/finance-ops`, `/finance-ops/payment-plan` |
| **system-status** `[sa,bm]` | `/system-status`, `/system-status/health`, `/system-status/errors`, `/system-status/audit-log`, `/system-status/links` |
| **settings** `[sa,bm]` | `/settings/membership`, `/settings/roles` |

*(sa = sysadmin, bm = boardMember, kh = keyholder, cert = MAY_CERTIFY_OTHERS. `/access-denied`, `/signin`, `/membership/*`, `/trusted-adults` legacy/utility routes — exclude unless a reason surfaces.)*

**Open question for implementer:** confirm whether `/membership/*` and the bare `/trusted-adults` are live or legacy duplicates of the `/safety/*` versions before listing them.

---

## 3. MVP — the first slice

A new `/index` route + nav item below Settings. One client page.

### Data: a flat page registry
New module, e.g. `src/components/pageRegistry.ts`:

```ts
type PageEntry = {
  href: string;
  label: string;        // human name, e.g. "Audit Log"
  section: string;      // group heading, e.g. "System Status"
  keywords?: string;    // extra search terms not in label
  visible: (user: SessionUser | undefined, signedIn: boolean) => boolean;
};
```

- **Reuse, don't duplicate, the gates.** Define one predicate per section (lift the existing `NAV_ITEMS` predicates so both render from the same constants), and attach the section predicate to each of its routes. When a route's gate ever diverges from its section, that's the only time it gets its own predicate.
- `NAV_ITEMS` can later be *derived* from this registry (top-level entries = registry rows flagged `topLevel`), collapsing two lists into one. **Not required for MVP** — leave `NAV_ITEMS` as-is, just don't fork the predicate logic. `ponytail:` one registry, derive nav later if it earns it.

### Page: `/index`
- Client component. `const { data: session } = useSession()`; `user = session?.user`.
- Filter registry by `visible(user, signedIn)` — same call shape AppFrame uses.
- **Search box** at top (Mantine `TextInput`, autofocus): case-insensitive substring match over `label + section + keywords`. Plain `useState` filter, no debounce needed for ~60 static rows.
- Render grouped by `section` (headings), each row a `NavLink`/`Anchor` to `href`. Empty-state line when filter matches nothing.
- Keyboard: Enter navigates to first match (nice-to-have, defer if it adds noise).

### Nav wiring
Add one `NAV_ITEMS` entry after Settings (AppFrame L122):
```ts
{ href: '/index', label: 'Index', icon: <IconList size={18} />, visible: (_u, signedIn) => signedIn },
```
Visible to every signed-in user — the Index itself is just a directory; each listed page stays gated by its own predicate, so showing the Index to all signed-in users leaks nothing.

### No new auth surface
The Index renders only rows whose `visible()` passes, and every target still enforces its own `useRequireRole` on arrival. The Index is a convenience layer over existing gates — it grants nothing. (Same governing rule as My Programs: no new capability, no new info.)

---

## 4. Deferred (not MVP)

- **Command palette** (Cmd-K global overlay) — the registry built here is exactly its data source; add the overlay later if wanted.
- **Dynamic detail pages** (`programs/[id]`, etc.) in results — needs live data, out of scope.
- **Badges / todo counts** on Index rows — reuse `navBadgeFor` if it earns its keep.
- **Deriving `NAV_ITEMS` from the registry** — collapses duplication but is a refactor with its own blast radius; do it once the registry proves out.
- **Recently-visited / favorites** ordering.

---

## 5. Risks / things to verify

1. **Registry drift.** A flat list can rot as routes are added/removed. Mitigation: a cheap test that walks `src/app/**/page.tsx` and asserts every non-dynamic route is either in the registry or on an explicit exclude list. One `test_*` guard, fails when someone adds a page and forgets the registry.
2. **Gate divergence.** If a sub-page ever gets a stricter gate than its section, the section-level predicate would over-list it. Low risk today (all sub-pages inherit), but the per-route `visible` override exists for exactly this.
3. **Legacy routes** (`/membership/*`, `/trusted-adults`) — resolve the open question in §2 before listing.
