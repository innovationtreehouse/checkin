# Badge Audit — numeric count circles / badges

Audit of every badge in the frontend that renders a **number/count**. Pure
status-label pills ("ACTIVE", "PENDING", role tags) are excluded unless they
carry a count. Read-only audit — no code changed.

Sources swept: `navBadges.ts` (`navBadgeFor` / `tabBadgeFor`), `AppFrame.tsx`
(left nav render), every `app/*/layout.tsx`, `SectionTabs.tsx`, and a repo-wide
grep of `<Badge` / `circle` in `checkin-app/src`.

> **Uncommitted rows:** `reviewBadges` / `todoCounts.review.*` are **not** in
> this worktree checkout (`navBadges.ts` has no `reviewBadges`). Rows **R1/R2**
> below are reconstructed from the task description and marked `(uncommitted)`.
> Verify against the branch that carries them before relying on their styling.

Color legend: `treehouseGreen` = custom theme brand green; `green` = Mantine
default green (**visibly different** from `treehouseGreen`). Mantine
`variant="light"` = translucent tint; `variant="filled"` = solid. Mantine's
default `<Badge>` variant is **filled**.

---

## 1. Inventory

### Left navbar (AppFrame sidebar) — all via `navBadgeFor`, rendered at `AppFrame.tsx:329`

Every sidebar badge shares one render: `size="md" variant="filled"
c="black"`, default pill shape, `color = gray→gray.5 : else the intent color`.
Solid `gray.5` (not `light`) is deliberate — the sidebar is dark purple, a
translucent tint would read dark.

| # | What is counted | Location | Source | FG | BG | variant | size | shape | Intent |
|---|-----------------|----------|--------|----|----|---------|------|-------|--------|
| N1 | Household items needing attention | left navbar `/my-household` | `navBadgeFor` → `member.household.length` | black | treehouseGreen | filled | md | pill | action (green) |
| N2 | Pending attendance the lead must confirm | left navbar `/my-programs` | `navBadgeFor` → `leadPendingCount` | black | treehouseGreen | filled | md | pill | action (green) |
| N3 | My household currently in the building | left navbar `/attendance` | `navBadgeFor` → `buildingHousehold` | black | **blue** | filled | md | pill | info (blue) |
| N4 | Everyone currently in the building | left navbar `/attendance` | `navBadgeFor` → `building` | gray-8 | gray.2 | filled | md | pill | info (gray) |
| N5 | Active/running programs | left navbar `/programs` | `navBadgeFor` → `activePrograms` | gray-8 | gray.2 | filled | md | pill | info (gray) |
| N6 | Membership apps board can act on (BLOCKED) | left navbar `/membership-ops` | `navBadgeFor` → `admin.membership` | black | treehouseGreen | filled | md | pill | action (green) |
| N7 | Leadless households needing a lead | left navbar `/membership-audit` | `navBadgeFor` → `admin.brokenHouseholds` | black | treehouseGreen | filled | md | pill | action (green) |
| N8 | Households missing contact + unclaimed accts | left navbar `/membership-audit` | `navBadgeFor` → `householdsMissingContact + unclaimedHouseholds` | gray-8 | gray.2 | filled | md | pill | info (gray) |
| N9 | Pending payment-plan approvals | left navbar `/finance-ops` | `navBadgeFor` → `admin.paymentPlanPending` | black | treehouseGreen | filled | md | pill | action (green) |
| N10 | Trusted-adult disclosures to review | left navbar `/safety` | `navBadgeFor` → `admin.trustedAdults` | black | treehouseGreen | filled | md | pill | action (green) |
| R1 | Background checks I can review now `(uncommitted)` | left navbar `/membership-ops` | `reviewBadges` → `review.canActOn` | black | treehouseGreen | filled | md | pill | action (green) |
| R2 | I approved, awaiting second reviewer `(uncommitted)` | left navbar `/membership-ops` | `reviewBadges` → `review.approvedAwaitingSecond` | gray-8 | gray.2 | filled | md | pill | info (gray) |

### Top subtabs (per-section layout tab bars)

| # | What is counted | Location | Source | FG | BG | variant | size | shape | Intent |
|---|-----------------|----------|--------|----|----|---------|------|-------|--------|
| T1 | In-flight applications (status≠ACTIVE) | top subtab `/membership-ops/applications` | `tabBadgeFor` → `admin.applicationsTotal` | gray-8 | gray.2 | filled | md | pill | info (gray) |
| T2 | Total member families | top subtab `/membership-ops/households` | local `memberFamilies` state | gray-8 | gray.2 | filled | md | pill | info (gray) |
| R3 | Background checks I can review now `(uncommitted)` | top subtab `/membership-ops/review` | `reviewBadges` → `review.canActOn` | black | treehouseGreen | filled | md | pill | action (green) |
| R4 | I approved, awaiting second reviewer `(uncommitted)` | top subtab `/membership-ops/review` | `reviewBadges` → `review.approvedAwaitingSecond` | gray-8 | gray.2 | filled | md | pill | info (gray) |
| T3 | Leadless households without a lead | top subtab `/membership-audit/broken` | `tabBadgeFor` → `admin.brokenHouseholds` | black | treehouseGreen | filled | md | pill | action (green) |
| T4 | Households missing an emergency contact | top subtab `/membership-audit/emergency-contacts` | `tabBadgeFor` → `householdsMissingContact` | gray-8 | gray.2 | filled | md | pill | info (gray) |
| T5 | Unclaimed-account households | top subtab `/membership-audit/unclaimed` | `tabBadgeFor` → `unclaimedHouseholds` | gray-8 | gray.2 | filled | md | pill | info (gray) |
| T6 | Trusted-adult disclosures to review | top subtab `/safety/trusted-adults` | `tabBadgeFor` → `admin.trustedAdults` | black | treehouseGreen | filled | md | pill | action (green) |
| T7 | Pending attendance to confirm | top subtab `/my-programs/attendance` | `leadPendingCount` | black | treehouseGreen | filled | md | pill | action (green) |
| T8 | Conflicts to resolve | top subtab `/my-programs/conflicts` | local `conflicts.length` | white | red | filled | md | pill | alert (red) |

### Other (card header / page badge / inline button)

| # | What is counted | Location | Source | FG | BG | variant | size | shape | Intent |
|---|-----------------|----------|--------|----|----|---------|------|-------|--------|
| O1 | Things-to-do count | card header (`TodoCard.tsx:32`, on My Household page) | `member.household + member.programs` length | black | treehouseGreen | filled | md | pill | action (green) |
| ~~O2~~ | ~~Reviewer's pending bg-check queue~~ | **DELETED** — redundant with the green `review.canActOn` nav+tab pill (branch `claude/cool-chatelet-760f39`); same count, same gate | — | — | — | — | — | — |
| O3 | Blocked applications | inline button badge (`Notifications.tsx`) | `/api/notifications` `membership.blocked` | white | red | filled | md | pill | alert (red) |
| O4 | People currently present | page header badge (`attendance/current/page.tsx:366`) | local `counts.total` | gray-8 | gray.2 | filled | lg | pill (● leftSection) | info (gray) |
| O5 | Per-status application tallies ("BLOCKED: 3") | inline page badges (`membership-ops/applications/page.tsx:184`) | local `statusCounts` | per `statusColor` (tint) | per `statusColor` (light) | light | default | pill | info |
| O6 | Import-row count per status filter | button rightSection (`participants/import/page.tsx:181`) | local `count` | per `meta.color` (tint) | per `meta.color` (light) | light | sm | pill | info |
| O7 | RSVP tally Yes/Maybe/No | inline page badges (`my-programs/attendance/page.tsx:69-71`) | local `tally.{yes,maybe,no}` | green/yellow/red (tint) | green/yellow/red (light) | light | default | pill | info |

---

## 2. Divergence analysis (grouped by intent)

### GREEN "action-required" badges — ✅ RESOLVED

All aligned to `treehouseGreen` fill + `black` text + `md` + pill (N-series, T3,
T6, T7, O1, R3). Was the core offender; no divergence left.

### GRAY "informational" badges — ✅ RESOLVED

All aligned to `gray.2` fill + `gray-8` text + filled + `md` + pill (nav
N4/N5/N8/R2, tabs T1/T4/T5/R4, total T2). Was a three-way split (nav `gray.5`
black, membership-ops `light gray gray-7`, membership-audit `gray.2 gray-8`,
plus T2's dark `gray.8`/white counter); all collapsed to one look.

### RED "alert" badges — ✅ RESOLVED

Both `red` filled + `white` text + `md` + pill (T8, O3). O3 bumped `sm`→`md`
and pinned `white` to match — the white pin is a no-op in O3's button context
but matches the future `<CountBadge intent="alert">` prop set, so extraction is
a clean swap.

### Other intents (blue)

- N3 blue (household-in-building) — one-off info color, fine.
- ~~O2 grape (reviewer queue)~~ — **DELETED.** Was an off-language grape button
  on the home page; the green `review.canActOn` nav+tab pill (branch
  `claude/cool-chatelet-760f39`) is the same count + gate in the right place.
- O4 (people present) — **now matches the gray colors** (`gray.2`/`gray-8`/filled,
  keeps its ● leftSection and `lg` header size); was teal `light`.
- O5/O6/O7 — per-status `light` tallies, color carries meaning (status/RSVP).
  Legitimately varied; leave alone.

---

## 3. Recommendation

**The count-badge divergence is now resolved by hand.** Two shared looks:
- **action** = `treehouseGreen` filled + `black` text
- **info/gray** = `gray.2` filled + `gray-8` text

applied to both nav and tab badges (`md`, pill throughout). `gray.2` solid works
on the dark sidebar too (a `light` translucent tint was the thing that read dark
there — solid light-gray is fine), so nav and tab gray badges now share one look;
no nav-vs-tab fork remains.

1. ~~Fix T6 wrong green; normalize T6/T7/T8/O2/O3 to `md` pill.~~ **DONE.**
2. ~~Collapse green-action badges to `treehouseGreen`/`black`/`md`/pill.~~ **DONE.**
3. ~~Collapse gray-info badges (nav + both tab bars + T2 total) to
   `gray.2`/`gray-8`/`md`/pill.~~ **DONE.**

**Still worth doing (not blocking):** extract a shared `<CountBadge
intent="action|info|alert">` so these looks live in one place instead of being
hand-repeated across `AppFrame.tsx`, the layouts, `TodoCard`, and `Notifications`
— the values match now, but nothing *enforces* that they stay matched.

**Leave alone:** O5/O6/O7 (status/RSVP colors carry meaning), N3 (one-off info
color). T8/O3 red alert now fully aligned (`red`/filled/`white`/`md`).

**Deleted:** O2 (reviewer grape button) — superseded by the green
`review.canActOn` nav+tab pill on `claude/cool-chatelet-760f39`.
