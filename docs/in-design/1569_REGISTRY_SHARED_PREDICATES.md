# Registry shared predicates

**Issue:** #1569 · **Status:** design. No production code accompanies this doc.

The `/index` page directory declares its own permission predicates (`BOARD`,
`SHOP`, `SAFETY`, etc.) instead of reading the gates the sections actually
enforce. Two known divergences exist today; the fix is structural — make the
registry import the section's own predicate, not hold a parallel copy.

---

## 1. Current divergences

### 1a. Background-check reviewer hidden from Membership Ops

The membership-ops layout admits `isSysadmin`, `isBoardMember`,
`isBackgroundCheckReviewer`, and `isOperations`. The nav (AppFrame:115) matches
and includes `hrefFor` to route a reviewer-only user to `/membership-ops/review`.

The registry maps every membership-ops route to `BOARD` (sysadmin or board),
except `/membership-ops/participants` (`BOARD_OR_OPS`). `RegistryUser` does not
carry `isBackgroundCheckReviewer` at all, so no per-route override can express
the reviewer gate either.

Result: a reviewer sees no Membership Ops rows in the index directory.

### 1b. `/shop-ops/create` over-listed to certifiers

`SHOP_NAV_LINKS` gates Create on `isAdmin` (sysadmin or board). The registry
lists it under `SHOP`, which includes certifiers. A certifier who is neither
sysadmin nor board sees the link but cannot use the page.

### 1c. Settings nav hides operations

The settings layout admits `isSysadmin`, `isBoardMember`, and `isOperations`.
The nav (AppFrame:148–152) only checks board. An operations user can reach
`/settings/outreach` (which gates on `["isBoardMember", "isSysadmin",
"isOperations"]`) but the nav hides the Settings entry entirely. The registry
has it right — `BOARD_OR_OPS` on outreach — but the nav disagrees with the
layout. This is the same shape as 1a with the roles reversed: the real gate
admits someone the nav hides.

Not a security issue in any case — every target re-enforces its own gate.

---

## 2. The model: facilityNav.ts

`facilityNav.ts` already follows the pattern the issue asks for:

- Per-link roles: `FACILITY_RECORD_ROLES`, `FACILITY_AGGREGATE_ROLES`
- Section gate derived: `FACILITY_SECTION_ROLES = [...new Set(links.flatMap(l => l.roles))]`
- Layout: `useRequireRole(FACILITY_SECTION_ROLES)`, tab filter via `visibleFacilityLinks(user)`
- Nav (AppFrame): `visible: (u) => FACILITY_SECTION_ROLES.some(r => !!u?.[r])`

The registry is the only consumer that doesn't use it yet.

`shopNav.ts` follows a similar pattern with `shopRoles()`, but the registry
reimplements its body instead of calling it.

---

## 3. Section-by-section plan

### 3.1 Sections that already export their gate

| Section | Module | Export | Registry change |
|---|---|---|---|
| Facility Ops | `facilityNav.ts` | `FACILITY_SECTION_ROLES`, per-link `roles` | Import. Per-route `visible` calls `visibleFacilityLinks` logic — or map each link's `roles` to its `href`. |
| Shop Ops | `shopNav.ts` | `shopRoles()`, per-link `visible` | Import `shopRoles`. Section gate: `shopRoles(u).isCertifier`. Per-route: call each link's `visible(shopRoles(u))`. Fixes §1b. |

### 3.2 Sections that need a new export

**Membership Ops** — the most complex case.

`membershipOpsNav.ts` already exports `MEMBERSHIP_OPS_NAV_LINKS` (labels +
hrefs) but no roles. The layout builds per-tab visibility inline:

- `/membership-ops/review` → `canReview` (bg-check reviewer or board)
- `/membership-ops/participants` → `isAdmin || isOps`
- everything else → `isAdmin`

Extract to `membershipOpsNav.ts`:

```ts
export const MEMBERSHIP_OPS_SECTION_ROLES: BusinessRole[] =
  ['isSysadmin', 'isBoardMember', 'isBackgroundCheckReviewer', 'isOperations'];

export function visibleMembershipOpsLinks(
  user: SessionUser | undefined
): NavLink[] {
  const isAdmin = !!user?.isSysadmin || !!user?.isBoardMember;
  const isOps = !!user?.isOperations;
  const canReview = !!user?.isBackgroundCheckReviewer || !!user?.isBoardMember;
  return MEMBERSHIP_OPS_NAV_LINKS.filter((l) => {
    if (l.href === '/membership-ops/review') return canReview;
    if (l.href === '/membership-ops/participants') return isAdmin || isOps;
    return isAdmin;
  });
}
```

The layout calls `visibleMembershipOpsLinks(sessionUser)` instead of inline
filter. The registry calls it too (or reads the per-link visibility). The nav
(AppFrame) switches to `MEMBERSHIP_OPS_SECTION_ROLES.some(...)`.

`RegistryUser` gains `isBackgroundCheckReviewer?: boolean` to express this.

**Safety** — extract `SAFETY_SECTION_ROLES` to a small `safetyNav.ts`:

```ts
export const SAFETY_SECTION_ROLES: BusinessRole[] =
  ['isSysadmin', 'isBoardMember', 'isKeyholder'];
```

The layout's `useRequireRole(['isSysadmin', 'isBoardMember', 'isKeyholder'])`
becomes `useRequireRole(SAFETY_SECTION_ROLES)`. The nav and registry import the
same constant. The per-tab gate (trusted adults = board only) stays in the
layout, since `/safety/trusted-adults` isn't a separately gated page.tsx — it's
filtered inline.

**Settings** — extract `SETTINGS_SECTION_ROLES` alongside per-page roles. The
settings layout doesn't have a nav module; the simplest form:

```ts
export const SETTINGS_SECTION_ROLES: BusinessRole[] =
  ['isSysadmin', 'isBoardMember', 'isOperations'];
```

Exported from a `settingsNav.ts` or from the layout itself (the layout is
`"use client"` but the constant is plain data). The nav (AppFrame) switches from
`!!u?.isSysadmin || !!u?.isBoardMember` to `SETTINGS_SECTION_ROLES.some(...)`.
This fixes §1c: operations sees the Settings nav entry and can reach Outreach.

Per-page overrides in the registry stay as they are — `SYSADMIN` for
localization, `BOARD` for email/webhook/membership — since each page gates
independently.

### 3.3 Simple board-only sections

| Section | Layout gate | Registry predicate | Match? |
|---|---|---|---|
| Membership Audit | `["isSysadmin", "isBoardMember"]` | `BOARD` | ✓ |
| Program Ops | `isSysadmin \|\| isBoardMember` | `BOARD` | ✓ |
| System Status | `["isSysadmin", "isBoardMember"]` | `BOARD` | ✓ |
| Finance Ops | `["isBoardMember"]` | `BOARD_ONLY` | ✓ |

These are correct today. Each section's gate is trivially `BOARD` or
`BOARD_ONLY`, matching the registry. The drift risk is near-zero: these
sections' gates have not changed since they were written.

Two options:
- **Extract anyway** for consistency: each exports a `*_SECTION_ROLES` constant.
  Mechanical, no risk.
- **Leave the registry's named predicates**: `BOARD` and `BOARD_ONLY` are defined
  once in the registry, not re-derived from session fields. They match the
  layouts today and will match tomorrow unless the section adds a new role —
  at which point the extraction happens as part of that change.

Recommendation: extract. The cost is four one-line constants; the benefit is
that every section follows the same pattern and a reviewer never has to ask
"does this one drift?"

---

## 4. RegistryUser

Add `isBackgroundCheckReviewer?: boolean`. The field already exists on
`SessionUser` (via `BusinessRole` in `types/auth.ts`) and on the session —
the membership-ops layout reads it. The registry just doesn't carry it.

No other new fields needed. All other gates resolve to existing `RegistryUser`
fields.

---

## 5. Registry shape after

The registry's local predicates (`BOARD`, `SHOP`, `SAFETY`, etc.) are deleted.
Each route's `visible` calls the section's exported predicate or — for routes
with a per-route override — a function derived from the section's exports.

```ts
// Section gates — imported, not retyped
import { FACILITY_SECTION_ROLES } from '@/lib/facilityNav';
import { shopRoles } from '@/lib/shopNav';
import { MEMBERSHIP_OPS_SECTION_ROLES, visibleMembershipOpsLinks } from '@/lib/membershipOpsNav';
import { SAFETY_SECTION_ROLES } from '@/lib/safetyNav';
import { SETTINGS_SECTION_ROLES } from '@/lib/settingsNav';
// ...

// Helpers that turn imported predicates into `Visible`
const roleGate = (roles: BusinessRole[]): Visible =>
  (u) => roles.some((r) => !!u?.[r]);

const FACILITY = roleGate(FACILITY_SECTION_ROLES);
const SAFETY = roleGate(SAFETY_SECTION_ROLES);
// Shop needs its own shape because shopRoles resolves toolStatuses
const SHOP: Visible = (u) => shopRoles(u).isCertifier;
// etc.
```

Per-route overrides stay where they are (`/membership-ops/participants` =
`BOARD_OR_OPS`, `/settings/localization` = `SYSADMIN`). The difference is that
the section default is now derived, not retyped.

---

## 6. Guardrail

The issue mentions a possible predicate-agreement test. With shared predicates,
the test becomes: "does the registry's `visible` for route X agree with the
section's exported predicate (or per-link gate) for X?"

That test is worth writing if there are still per-route overrides in the
registry — it would catch a new override that contradicts the section's gate.
It's not worth writing if every route's `visible` is mechanically derived from
the section's export, because there would be nothing left to disagree.

Recommendation: skip the guardrail test in this change. The structural fix
(imported predicates) removes the class of bug. If per-route overrides grow,
revisit.

---

## 7. Ordering

1. Extract the four section predicates (membership-ops, safety, settings, and
   the simple board-only sections) into their nav modules.
2. Wire the layouts and AppFrame nav to call the exported constants.
3. Add `isBackgroundCheckReviewer` to `RegistryUser`.
4. Replace the registry's local predicates with imports + `roleGate`.
5. Delete the now-unused local predicate constants.

Steps 1–2 are safe refactors (no behavior change — the same roles, now from one
source). Step 3–4 fixes the two divergences. Step 5 is cleanup.

All steps ship in one PR; the boundary-isolation rule does not apply (no
security registry/handler/scope-binding changes).
