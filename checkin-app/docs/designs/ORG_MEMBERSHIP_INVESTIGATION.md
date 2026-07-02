# OrgMembership (Phase 4) — Investigation & Scope

**Status:** investigation only. No code/schema/migration changes made. Base: `main` @ `6d919079`.
Canonical dictionary: [`VOCABULARY.md`](../VOCABULARY.md) + [`PARTICIPANT_TERMINOLOGY_PROPOSAL.md`](PARTICIPANT_TERMINOLOGY_PROPOSAL.md) §Phase 4.

**Goal (decided):** the **org-membership** relationship gets an explicit qualified name.
Bare `member`/`Membership` for "belongs to the org / active facility membership" is banned →
`OrgMembership` / `isActiveOrgMember` / `orgMember…` / UI **"Treehouse Member"**.
Leave-alone senses (board member, corporation member, householdMember) do **not** rename.

> **DB is wiped on deploy** → migrations need no data care. But raw-SQL partial indexes must
> be re-created (see §a) — use `RENAME`, not drop+add, or you lose them silently.

**Headline blast-radius numbers** (excluding `prisma/schema.prisma`):
- (A) org-membership identifier hits in `src/`: **~397 incl-test / ~252 non-test**, across ~90 files.
- `membership-ops/*` surface: **20** app pages + **13** api routes; `api/membership/*`: **9** routes; plus `lib/membership/*` (**9** files) and `membership-audit/*` (separate dir, 8 files).
- **New find not in the brief:** `'member'` is a first-class **security field-visibility tier** (`Tier = 'public' | 'member' | …`) — 53 hits in `src/security`, 34 in `registry.ts` alone. Renaming it is a separate, security-contract axis. **See §e / OQ-1 — biggest hidden decision.**

---

## (a) Schema rename blast radius

File: `prisma/schema.prisma`.

### Models / enums — RENAME (A)

| Line | Current | Proposed | Notes |
|---|---|---|---|
| 296 | `model Membership` | `model OrgMembership` | 1:1 with Household (`householdId @unique`). Core (A) model. |
| 315 | `model MembershipProcess` | `OrgMembershipProcess` *(confirm — OQ-2)* | Lifecycle of an application/renewal. |
| 234 | `enum MembershipStatus` | `OrgMembershipStatus` *(confirm — OQ-2)* | Values `NONE/ACTIVE/REVOKED/DENIED` stay. |
| 245 | `enum MembershipProcessKind` | `OrgMembershipProcessKind` *(confirm — OQ-2)* | `INITIAL/RENEWAL`. |
| 250 | `enum MembershipProcessStatus` | `OrgMembershipProcessStatus` *(confirm — OQ-2)* | Stage enum. |

### Fields / relations that move with the models

| Line | Field | Change | Notes |
|---|---|---|---|
| 171 | `Household.membership Membership?` | type → `OrgMembership?`; **field rename `membership`→`orgMembership`? (OQ-3)** | Back-ref. Type must change; the *field name* is the question. |
| 302 | `Membership.status MembershipStatus` | type follows enum | |
| 310 | `Membership.processes MembershipProcess[]` | type follows | |
| 315-320 | `MembershipProcess.membershipId` / `.membership` relation | FK/relation to renamed model | Raw-SQL indexes reference `"MembershipProcess"("membershipId")` — see below. |
| 358 | `@@index([membershipId])` | regenerated | |
| 367 | `BackgroundCheckAttestation.process MembershipProcess` | type follows | |

### Price tiers on Program / Fee — RENAME (A)

| Line | Field | Proposed |
|---|---|---|
| 603 | `Program.memberOnly` | `orgMemberOnly` |
| 615 | `Program.memberPriceCents` | `orgMemberPriceCents` |
| 618 | `Program.nonMemberPriceCents` | `nonOrgMemberPriceCents` |
| 622 | `Program.shopifyMemberVariantId` | `shopifyOrgMemberVariantId` *(if shopify* follows — OQ-4)* |
| 624 | `Program.shopifyNonMemberVariantId` | `shopifyNonOrgMemberVariantId` *(OQ-4)* |
| 673 | `Fee.nonMemberPriceCents` | `nonOrgMemberPriceCents` |
| 676 | `Fee.memberPriceCents` | `orgMemberPriceCents` |

### `BoardSettings` membership-product fields — AMBIGUOUS (OQ-5)

These carry bare `membership` but are the **dues product / payment config**, not the member/non-member *tier*:

| Line | Field | Question |
|---|---|---|
| 400 | `membershipYearBoundary` | bare "membership" → `orgMembershipYearBoundary`? |
| 408 | `membershipVariantId` | Shopify variant of the membership product. → `orgMembership…`? |
| 418 | `shopifyMembershipProductId` | → `shopifyOrgMembershipProductId`? |
| 420/422 | `shopifyNormalVariantId` / `shopifyVolunteerVariantId` | No "member" token — **leave** (normal/volunteer dues tiers). |

### Raw-SQL / index notes (migration must preserve)

- `MembershipProcess` has **two raw-SQL partial unique indexes**:
  `membership_one_inflight_initial` and `membership_one_inflight_renewal`
  (`prisma/migrations/20260630010000_*`, `20260628000000_*`), each
  `CREATE UNIQUE INDEX … ON "MembershipProcess"("membershipId") WHERE …`.
  Prisma can't express partial-unique-on-enum, so they live in raw SQL. **Use `ALTER TABLE … RENAME`
  in the migration** — a drop+recreate of the model would drop these and they must be hand-re-added.
  (Lesson from prior FK renames — tsc is blind to this; see repo memory `fk-rename-tsc-not-enough`.)
- `@@index([status])` on Membership (`:305`), `@@index([membershipId])` on Process (`:358`) — auto, regenerate.

### Generated / security schema artifacts (regenerate or hand-edit)

- `src/security/generated/classifications.ts` — model keys `Membership` (`:64,367`),
  `MembershipProcess` (`:71,371`), relation `Household.membership` (`:356`), and the price fields
  (`:178,183-187,205-206`). **Generated** — regenerate after schema rename.
- `src/security/scopeBindings.ts:55` — `Membership: { their_households: { field: 'householdId', … } }`
  (model-keyed, hand-edit); `:154` lists the string `'MembershipProcess'`. **CODEOWNERS-guarded security file.**

---

## (b) The `member`/`Member`/`Membership` buckets

### (A) Org membership → RENAME

**Read-model core — `src/lib/membership.ts`** (rename the file too? OQ-6):

| Line | Symbol | Proposed |
|---|---|---|
| 12 | `ACTIVE_MEMBER_PARTICIPANT_WHERE` | `ACTIVE_ORG_MEMBER_PERSON_WHERE` *(note: type is already `PersonWhereInput`; "PARTICIPANT" in the name is stale post-Person-umbrella — good time to fix)* |
| 22 | `ACTIVE_MEMBER_INCLUDE` | `ACTIVE_ORG_MEMBER_INCLUDE` |
| 30 | `isActiveMember(participantId)` | `isActiveOrgMember(personId)` — param name also stale |
| 45 | `participantRecordIsActiveMember` | `personRecordIsActiveOrgMember` |
| 59 | `membershipStatusBlocksLogin` | `orgMembershipStatusBlocksLogin` *(confirm — it is the org login gate)* |

**Read-model call sites:**

| File:line | Use |
|---|---|
| `src/lib/authClaims.ts:3,32` | `membershipStatusBlocksLogin(p.household?.membership?.status)` |
| `src/app/api/people/search/route.ts:4,42` | `participantRecordIsActiveMember(p)` → `isMember` wire key |
| `src/app/api/programs/[id]/route.ts:5,54` | `isActiveMember` (member-gate) |
| `src/app/api/programs/route.ts:7,15,31` | `isActiveMember`, `memberOnly` gating, `canSeeMemberOnly` |
| `src/app/api/programs/[id]/eligible-participants/route.ts:3,45` | `ACTIVE_MEMBER_PARTICIPANT_WHERE` |
| `src/app/api/shop/members/route.ts:3,12` | `ACTIVE_MEMBER_PARTICIPANT_WHERE` (the shop roster) |
| `src/lib/__tests__/membershipLoginGate.test.ts` | full `membershipStatusBlocksLogin` suite |

**Price fields** (Program/Fee) — consumers (non-test), all rename with the fields:
`src/app/api/programs/[id]/route.ts`, `…/settings/route.ts`, `…/participants/route.ts`,
`…/public-register/route.ts`, `api/programs/route.ts`; UI `program-ops/new/page.tsx`,
`program-ops/programs/page.tsx`, `program-ops/programs/[id]/page.tsx`, `programs/page.tsx`,
`programs/[id]/page.tsx`, `programs/[id]/register/page.tsx`, `finance-ops/payment-plan/page.tsx`;
`lib/shopify.ts`, `lib/dev/seed-helpers.ts`. (~13 non-test files; matching `__tests__`/integration mirrors.)

**Membership model/enum/process consumers** (prisma access, types) — non-test, all (A):
`lib/membership/*` (external, intake, notifications, payment, phases, renewal, review, boardAlerts),
`api/membership/*` (route, renew, renewal-status, reviews, contract/*, payment, intake/*),
`api/membership-ops/*` (applications, households, participants/*), `api/nav/todo-counts/route.ts`,
`api/settings/membership/volunteer-designations/route.ts`, `api/webhooks/shopify/route.ts`,
`lib/authClaims.ts`, `lib/dev/zoho-import.ts`, `lib/dev/seed-helpers.ts`,
`components/MembershipFlowStepper.tsx`, `components/Notifications.tsx`, `components/navBadges.ts`,
`membership/page.tsx`, `my-household/page.tsx`, `membership-ops/*`, `programs/[id]/page.tsx`.

**`memberFamilies` counter (A):** `membership-ops/layout.tsx:41,98` + `api/nav/todo-counts/route.ts:353,364` → `orgMemberFamilies`.

### (LEAVE) — do not rename

| Sense | Anchors | Why leave |
|---|---|---|
| **Board member** | `schema.prisma:104 isBoardMember`; `registry.ts` `['isBoardMember', …]` (many rows); "Board Member" copy. ~336 board-member hits. | Role flag, not org membership. |
| **Corporation member** | `model CorporationMember` (`schema.prisma:574`), `CorporationLead` (`:562`); `generated/classifications.ts`. | Corporate-membership sense (4th "member"). |
| **Household member** | `householdMember`, `/api/household/member`, `lib/household/activityMembers.ts`. ~53 hits. | Phase 3, shipped. `/household/` segment already qualifies it. |

### FLAG FOR HUMAN — ambiguous

- **`'member'` security tier** — see §e / OQ-1. Conceptually org-membership, but a visibility contract.
- **`BoardSettings.membership*` product fields** — §a / OQ-5.
- **`membershipStatusBlocksLogin`** — org sense, but it is the *login gate*; confirm it takes `orgMembership…` (OQ-6).
- **`membership-audit/*`** (separate dir from `membership-ops/*`) — 8 files, org-membership-scoped audits. Does it follow the same route/label decision as membership-ops? (OQ-7)

---

## (c) API path + security registry + consumers for `/api/shop/members` → `/api/shop/org-members`

| Layer | File:line | Change |
|---|---|---|
| Route | `src/app/api/shop/members/route.ts` | dir `members/` → `org-members/`; keep bag-key(`Person`)/envelope convention, add comment |
| Registry | `src/security/registry.ts:228` (`endpoint: 'GET /api/shop/members'`), `:230` (`envelope: 'members'`) | endpoint path → `/api/shop/org-members`; **envelope `members` → `org-members`? (OQ-8)** — wire-key contract |
| Consumer | `src/app/shop-ops/manage/ToolManagementPanel.tsx` (`fetch('/api/shop/members')`, reads `.members`) | fetch path + response key |
| Strip test | `src/security/__tests__/shop-members-strip.test.ts` | `ENDPOINT = 'GET /api/shop/members'` + describe |
| Integration | `src/app/__tests__/shopAPI.integration.test.ts` | import `@/app/api/shop/members/route`, asserts `.members` |
| Panel tests | `src/app/shop-ops/manage/__tests__/ToolManagementPanel.test.tsx`, `…/page.test.tsx` | mock key `"/api/shop/members": { members: … }` |

> **Wire-key rule (from VOCABULARY.md):** the serialized `members` envelope key is a contract — it renames
> **in this phase** (the phase that owns it), with all consumers moved together. The bag key is the *model
> name* (`Person`) driving field-strip and is unrelated to the "member" word — leave it, comment it.
> This is exactly the sliced-rename trap in repo memory (`sliced-rename-cross-dir-consumers`,
> `household-relation-rename-ci-only-breaks`): grep every consumer + the routeAuthDrift/strip oracles,
> grep-to-zero after merge.

Other membership routes (`/api/membership/*`, `/api/membership-ops/*`, `/api/membership-audit/*`) — path rename is the OQ-2/OQ-7 decision, not forced by this phase.

---

## (d) UI copy inventory → "Treehouse Member"

| File:line | Current copy | Target |
|---|---|---|
| `components/JoinTreehouseBanner.tsx:5,6,13,15` | "logged-in non-members", "not an active member", **"become a member today!"**, "membership application" | Treehouse Member wording |
| `programs/[id]/page.tsx:291` | **"Member Price:"** | "Treehouse Member Price:" |
| `programs/[id]/page.tsx:292` | **"Non-Member Price:"** | "Non-Member Price:" (public price) |
| `programs/page.tsx` (badge) | `memberOnly` → **"Members-Only"** badge | "Treehouse Members Only" |
| `program-ops/programs/page.tsx` | `memberOnly ? 'Members-Only' : 'Public'` | |
| `program-ops/new/page.tsx` | labels **"Member ($)"**, **"Non-Member ($)"**, checkbox **"Members-Only Program"** | |
| `program-ops/programs/[id]/page.tsx` | same labels (disabled view) | |
| `membership/page.tsx` (title) | **"Membership"** | "Treehouse Membership" |
| `my-household/page.tsx` | **"Become a member!"** button → `/membership` | |
| `membership-ops/layout.tsx:23` | aria-label **"{n} member families"** | "org member families" |
| `shop-ops/manage/ToolManagementPanel.tsx` | **"Certified members"** roster heading; `CERTIFIED` label | "Certified Treehouse Members" |
| `components/AdminEditHouseholdModal.tsx` | "…a household you're a member of." | (household-scoped — confirm sense) |

*(Copy strings verified via direct file reads; a Bash-output filter was mangling the literal word "member" so the table was assembled from `Read`, not `grep` stdout.)*

---

## (e) The `membership-ops/*` propagation question — biggest blast-radius call

Two distinct things named "membership" here:

**1. `membership-ops/*` route + nav + dir** (the admin ops surface):
- Nav: `src/lib/membershipOpsNav.ts` (`MEMBERSHIP_OPS_NAV_LINKS`, labels "Households"/"Applications"/"Background-check Review"/"Volunteer Memberships"), rendered by `membership-ops/layout.tsx`; hub `membership-ops/page.tsx` redirects to first entry.
- Dirs: `src/app/membership-ops/` (20 pages), `src/app/api/membership-ops/` (13 routes), plus sibling `src/app/membership-audit/` (8 files).
- **Question (OQ-7):** does `Org` prefix propagate to the dir names + route paths + nav labels
  (`/org-membership-ops`? "Org Membership Ops"? "Treehouse Membership"?), or does the ops surface
  stay `membership-ops` and only the *model + price + shop path + user copy* rename?
  This is the single biggest diff-size lever — renaming the dirs cascades into `pageRegistry`
  (`page-registry-drift-guard` — every `page.tsx` must be registered), nav tests, and every internal
  `router.push('/membership-ops/…')`.

**2. The `'member'` security tier** (`src/security/core.ts:41` `Tier = 'public' | 'member' | SensitiveTier | 'secret'`):
- A field-visibility tier meaning "visible to a *member* view" (a Treehouse Member sees `member`+`public`; anon sees only `public`). Definitions: `core.ts:6-10,23,41,55,104,106,241,243,245`; parser guards `scopes.ts:260`.
- Usage: **34** `'member'` tokens in `registry.ts` scope arrays; **1** `@sensitivity:member` schema tag (`schema.prisma:144`, on `ToolStatus`); `generated/classifications.ts:34` `level: 'member'`.
- **Question (OQ-1):** does the tier rename `'member'` → `'orgMember'`? It is org-membership in meaning,
  but it's a **typed security contract** touching the `Tier`/`Token` unions, every registry row, the
  `@sensitivity:` schema annotation, generated classifications, and the strip/scope tests
  (`fk-rename-touches-security-config`, `sensitivity-tiers`). High risk, tsc-partially-blind (string
  literals). **My recommendation: treat it as its own slice (or explicitly out-of-scope) — do NOT fold
  it into the model rename.**

---

## (f) Proposed phasing (mirror the Person A0/A1/A2 slicing)

The Person umbrella landed a big atomic model rename green by slicing. Same shape here — order so each
piece compiles + passes CI on its own:

- **P4a — leaf renames, no contract change (land first, green):**
  - `lib/membership.ts` read-model identifiers (`isActiveMember`→`isActiveOrgMember`, `ACTIVE_MEMBER_*`, `participantRecordIsActiveMember`) + their call sites. Pure internal symbol rename, tsc-caught.
  - UI copy → "Treehouse Member" (§d). No identifier/contract change.
- **P4b — price fields (schema + consumers, atomic):**
  - `Program`/`Fee` `memberOnly`/`memberPriceCents`/`nonMemberPriceCents` (+ shopify* per OQ-4) rename,
    RENAME migration, regenerate classifications, move all consumers + `__tests__`/integration mirrors
    in one commit. Recursive-WhereInput escapes are tsc-blind → run integration (`tsc-misses-prisma-rename-escapes`, `fk-rename-tsc-not-enough`).
- **P4c — shop path + envelope (contract, atomic):**
  - `/api/shop/members`→`/api/shop/org-members`, registry endpoint + envelope key, `ToolManagementPanel` fetch+read, strip + integration + panel-mock tests together (§c).
- **P4d — model/enum atomic flip (the heavy one):**
  - `Membership`→`OrgMembership` (+ `MembershipProcess`/`MembershipStatus`/… per OQ-2), RENAME migration
    preserving raw-SQL partial indexes, regenerate classifications, hand-edit `scopeBindings.ts`, sweep
    `lib/membership/*` + `api/membership*/*` + components. Big; do like Person A2 — one flip after leaves are green.
- **P4e (decision-gated, optional/separate):**
  - `membership-ops/*`/`membership-audit/*` dir+route+nav rename (OQ-7) — only if `Org` propagates.
  - `'member'` security tier rename (OQ-1) — its own slice if chosen.
  - `BoardSettings.membership*` product fields (OQ-5).

Pieces P4a, P4b, P4c can each land green independently before P4d. P4e is opt-in.

---

## (g) OPEN QUESTIONS (need answers before scoping the migration)

- **OQ-1 [security tier] — biggest.** Does the `'member'` field-visibility **security tier** rename to
  `'orgMember'`? (Touches `Tier`/`Token` unions, ~34 registry rows, the `@sensitivity:member` schema tag,
  generated classifications, strip/scope tests.) **Recommend: separate slice or explicitly leave.**
- **OQ-2 [enums/process].** Does `Org` propagate to `MembershipProcess`, `MembershipStatus`,
  `MembershipProcessKind`, `MembershipProcessStatus` — or does only `model Membership` become `OrgMembership`
  and the lifecycle enums/process keep "Membership"?
- **OQ-3 [relation field].** `Household.membership` field — rename to `orgMembership`, or keep the field name
  and only change its type?
- **OQ-4 [shopify variants].** Do `Program.shopifyMemberVariantId` / `shopifyNonMemberVariantId` follow
  (`shopifyOrgMember…`), or keep the shopify field names as-is?
- **OQ-5 [board settings].** `BoardSettings.membershipVariantId`, `shopifyMembershipProductId`,
  `membershipYearBoundary` — bare "membership": Org-prefix them, or leave (dues-product config)?
- **OQ-6 [read-model file + login gate].** Rename `lib/membership.ts` itself? And does
  `membershipStatusBlocksLogin` → `orgMembershipStatusBlocksLogin`?
- **OQ-7 [ops surface].** Does `Org`/"Treehouse Member" propagate to `membership-ops/*` **and**
  `membership-audit/*` dir names, route paths, and nav labels — or do the ops surfaces stay `membership-ops`
  while only model+price+shop-path+copy rename? (Biggest diff-size lever; cascades into pageRegistry + nav tests.)
- **OQ-8 [envelope key].** Confirm the `/api/shop/members` response envelope key `members` → `org-members`
  (wire contract moved this phase, all consumers together).
- **OQ-9 [leave-alone confirm].** Confirm **board member** (`isBoardMember`), **corporation member**
  (`CorporationMember`/`CorporationLead`), and **householdMember** all stay untouched.

### Answers (fill in)

- **OQ-1: LEAVE / separate slice.** `'member'` security tier stays as-is (or its own isolated slice). Not folded into this rename. → **P4e, opt-in only.**
- **OQ-2: PREFIX EVERYTHING.** `MembershipProcess`→`OrgMembershipProcess`, `MembershipStatus`→`OrgMembershipStatus`, `MembershipProcessKind`→`OrgMembershipProcessKind`, `MembershipProcessStatus`→`OrgMembershipProcessStatus`. Full consistency.
- **OQ-3: YES →** rename `Household.membership` field to `orgMembership` (consistent with prefix-everything).
- **OQ-4: YES, follow.** `Program.shopifyMemberVariantId`→`shopifyOrgMemberVariantId`, `shopifyNonMemberVariantId`→`shopifyNonOrgMemberVariantId`.
- **OQ-5: PREFIX THEM TOO.** `BoardSettings.membershipYearBoundary`→`orgMembershipYearBoundary`, `membershipVariantId`→`orgMembershipVariantId`, `shopifyMembershipProductId`→`shopifyOrgMembershipProductId`. (`shopifyNormalVariantId`/`shopifyVolunteerVariantId` unchanged — no "member" token.)
- **OQ-6: RENAME BOTH.** File `src/lib/membership.ts`→`src/lib/orgMembership.ts` (+ update imports); helper `membershipStatusBlocksLogin`→`orgMembershipStatusBlocksLogin`.
- **OQ-7: KEEP `membership-ops`.** Only model + enums + price + shop-path + user copy rename. `membership-ops/*` and `membership-audit/*` dir names, route paths, nav labels stay. → smallest-risk diff; no pageRegistry/nav-test cascade.
- **OQ-8: RENAME to `org-members`.** Envelope wire-key moves this phase (P4c); `ToolManagementPanel` + strip/integration/panel tests move together.
- **OQ-9: CONFIRMED — leave all three.** board member (`isBoardMember`), corporation member (`CorporationMember`/`CorporationLead`), householdMember (`/api/household/member`) untouched in Phase 4.

**Net scope after decisions:** rename `Org`-everything (model + all lifecycle enums/process + `Household.orgMembership` + price fields + shopify* variants + `BoardSettings.membership*` + `lib/orgMembership.ts` + login gate + shop path & envelope + UI copy). **Two things explicitly OUT:** the `'member'` security tier (OQ-1, own slice/leave) and the `membership-ops`/`membership-audit` ops-surface dir/route/nav paths (OQ-7, stay). Leave-alone senses confirmed (OQ-9).
