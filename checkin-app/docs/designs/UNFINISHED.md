# UNFINISHED — running followup ledger

Open decisions, deferred fixes, and not-yet-built items surfaced during the
2026-07-02 vocabulary sweep. Decided terms are recorded in
[../VOCABULARY.md](../VOCABULARY.md); this doc holds what's left to *act on*. Add
sections freely — we'll find more. Nothing here is implemented; investigation only.

**Legend:** 🔴 high-priority / risky · 🟡 decision needed · 🟢 mechanical fix ·
🔵 aspirational (not-yet-built) · 📖 record-in-dictionary only

---

## 🔴 Admin role ambiguity — its own discussion, do NOT touch inline

"Admin" is **not a column** (no `isAdmin` on `Person`) — a loose derived label that
resolves to **different role sets** in different files:

| Site | "admin" means |
|---|---|
| [shopNav.ts:29](../../src/lib/shopNav.ts#L29) | `isSysadmin \|\| isBoardMember` (either) |
| [orgAccount.ts:9](../../src/lib/orgAccount.ts#L9) | reads as both-required |
| [api/roles/route.ts:7](../../src/app/api/roles/route.ts#L7) | gate `['isSysadmin','isBoardMember']` (either) |
| [settings/roles/page.tsx](../../src/app/settings/roles/page.tsx) | Sysadmin / Board Member as **separate** columns |

Real flags: `isSysadmin` ([schema.prisma:102](../../prisma/schema.prisma#L102)),
`isBoardMember` ([schema.prisma:104](../../prisma/schema.prisma#L104)).

**Why risky:** if "admin" gates a sensitive action, a mismatched meaning is an
over-grant (board gets access it shouldn't) or under-grant. Product owner:
"ambiguity bad," and **too risky to change inline** — dedicated session required.
Also folds in the **privileged-"staff"** uses (`isStaff = isBoardMember ||
isSysadmin` [trusted-adults/route.ts:50](../../src/app/api/trusted-adults/route.ts#L50);
"staff-only" rosters [events/[id]/route.ts:55](../../src/app/api/events/[id]/route.ts#L55)).

**Decision to make:** (1) admin = sysadmin only or sysadmin+board? (2) single
canonical `isAdmin(user)` helper replacing scattered `||` checks? (3) reconcile
privileged-"staff" onto it. (4) audit every call site for over/under-grant.
**Until then: do not change any admin/`isStaff` gate.**

---

## 🟡 "Review" / "Reviewer" — followup (lower priority than Admin)

Four review flows share the word, and product owner isn't sure yet where each term
is used or whether they should converge:

- **BG Reviewer** role — `isBackgroundCheckReviewer` → "BG Reviewer".
- **Attestation reviewer** — `BackgroundCheckAttestation.reviewer`.
- **Membership review** — `/api/membership/reviews`, `membership-ops/review`.
- **Trusted-adult review** — `TrustedAdultReview.decidedBy` (a "reviewer" called a
  **"decider"** — is that the same concept?).

Decide: one canonical word, or keep distinct per subsystem; and reconcile
"decider" vs "reviewer". Deserves its own pass. _(VOCAB #9)_

---

## 🟢 "lead mentor" → "Program Leader" (decided)

**✅ Adopt "Program Leader"; retire "lead mentor"** (policy term). ~256-ref rename:
- `Program.leadMentorId` → `programLeaderId`
- relation `leadMentor` / `@relation("ProgramLeadMentor")` → `programLeader` / `"ProgramLeader"`
- `Program.leadMentorNotificationSettings` → `programLeaderNotificationSettings`
- `Person.programsLed` relation retargets (name can stay)
- "Lead Mentor" UI copy (63 refs) → "Program Leader"

Watch tsc-blind escapes (Prisma relation strings, mocks). _(VOCAB #7)_

---

## 🟢 "staff account" → "Treehouse Account"

Org-domain (`@innovationtreehouse.org`) account sense: rename `isStaffAccount` →
`isTreehouseAccount` (matches `isOrgAccount`); update copy
([my-household/page.tsx:331](../../src/app/my-household/page.tsx#L331),
[api/household/route.ts:53](../../src/app/api/household/route.ts#L53)) and the
`STAFF_ENTERED` value on `TrustedAdultOrigin`. **Not** the privileged-viewer sense
(that's Admin, above). _(VOCAB #7)_

---

## 🟢 Make `ToolLevel` rank explicit

Enum declares `BASIC, DOF, CERTIFIED, INSTRUCTOR, MAY_CERTIFY_OTHERS` but real rank
is `BASIC < CERTIFIED < DOF < INSTRUCTOR < MAY_CERTIFY_OTHERS`. Reorder (or add an
ordinal) so declaration order = rank; only `LEGEND_LEVELS` carries the truth today.
_(VOCAB #2)_

---

## ✅ Certifier "any-tool → global" widening — ACCEPTED (not a security issue)

**Decision (2026-07-02): fine as-is.** Certifiers are a small group; wide
access/visibility is acceptable. The `isCertifier` nav/access checks that fire on
holding `MAY_CERTIFY_OTHERS` on **any** tool (shopNav.ts:31,
access-resolvers.ts:135, pageRegistry.ts:36, AppFrame.tsx:101,
ToolManagementPanel.tsx:525) are intended convenience, not an over-grant. The
**actual grant action stays per-tool**
([certifications/route.ts:100](../../src/app/api/shop/certifications/route.ts#L100)) —
you can only certify others on a tool you're a certifier for — which is the part
that matters. No change needed. _(VOCAB #2)_

---

## 🟢 "Tool Certifier" vs "Shop Certifier" label

Code uses both; policy canonical = **Tool Certifier**. Retire "Shop Certifier"
([ToolLevelBadge.tsx:22](../../src/components/ToolLevelBadge.tsx#L22),
[RoleBadge.tsx:23](../../src/components/ui/RoleBadge.tsx#L23),
[security/core.ts:125](../../src/security/core.ts#L125)). _(VOCAB #2)_

---

## 🟢 Name the relief types: Payment Plan / Scholarship

Distinct from a **manual payment** (already renamed — `via: "manual"` /
`manualPaymentById`): **Payment Plan** (installments,
`isPaymentPlanRequested`) and **Scholarship** (board comp, 0 code refs today)
— one process handles either/both. The relief surfaces still say "certify":
`certifyPaymentPlan()`
([payment.ts:249](../../src/lib/membership/payment.ts#L249)), the route path
`/api/membership-ops/applications/certify-payment`, and the
`certificationNote` column, which now holds the note for BOTH a manual payment
and a payment-plan approval. _(VOCAB #17)_

---

## 🟢 "dues" → "membership fee"

Canonical money word = **fee**. Rename `normalDuesCents` →
`standardMembershipFeeCents`, `volunteerDuesCents` → `volunteerMembershipFeeCents`
(kills the `normal`=non-member trap). Coordinate with P4's `*PriceCents` work.
_(VOCAB #6)_

---

## 🟢 Dedup `SessionUser` type

`type SessionUser` redeclared inline in ≥4 places
([types/participant.ts:5](../../src/types/participant.ts#L5),
[attendance/current/page.tsx:42](../../src/app/attendance/current/page.tsx#L42),
[programs/[id]/page.tsx:36](../../src/app/programs/[id]/page.tsx#L36),
[AppFrame.tsx:53](../../src/components/AppFrame.tsx#L53)). Consolidate to one export;
rename the stale-named `types/participant.ts`. _(VOCAB #8)_

---

## 🟡 `household` vs `family` — keep the split, or unify?

Code is all `Household`; UI intermittently says "family" (and `TrustedAdult.familyContext`).
**Default = keep the split** — code `Household`, "family" allowed as warm user copy
(already recorded in VOCABULARY). To **unify** instead: rename field
`TrustedAdult.familyContext` → `householdContext` (`prisma/schema.prisma`) + consumers
(`api/safety/trusted-adults`, `api/trusted-adults/*`, `safety/trusted-adults/page.tsx`,
security registry + strip tests); "family" → "household" copy across
my-household / review / register / volunteer-memberships / my-activities;
`memberFamilies` → `memberHouseholds`. DB wiped on deploy → no data care.
_(was proposal Phase 5)_

## 🟢 Retire `dependent` + fix intake `children` bucket (BUG-2)

"dependent" is UI jargon for a **non-lead** household member — resolve to "household member".
- **BUG-2:** `lib/membership/intake.ts` `children` bucket = *every non-lead* (not
  offspring/age); it's the `children` wire key on `GET /api/membership` (`:131`) +
  `POST /api/membership/intake` (`:304`), consumed by `membership/page.tsx`
  (`prefill.children`, `buildPayload().children`). Rename key + type
  (`ChildInput` → `HouseholdParticipantInput`, `children` → `householdParticipants`/`dependents`)
  across server + client + page in one commit. **NOT `youth`** — it's a non-lead concept.
- **Copy:** `communication/page.tsx:11` label, `my-household:443`,
  `membership-ops/participants/import:138`, `trusted-adults:12`, `pageRegistry:26,66`,
  `api/programs/[id]/participants:64`, `notifications.ts:86` → "household member".
- **Persisted key:** `emailDependentCheckins` is a `notificationSettings` **JSON key**
  (not a column) → `emailHouseholdCheckins` in readers/writers
  (`notifications.ts:150`, `communication/page.tsx:27,41`, tests
  `notificationsCheckin.integration.test.ts:43,61` + `.perf.test.ts:28`). DB wiped → no backfill.
_(was proposal Phase 6)_

---

## 🟡 The `'member'` field-visibility TIER — left unrenamed by Phase 4 (decide if it ever should be)

Phase 4 renamed the org-membership **model/relationship** (`Membership` →
`OrgMembership`, price fields → `orgMember*`, `/api/shop/org-members`, "Treehouse
Member" copy — shipped #729/#731/#732/#735). It **deliberately did NOT touch** the
separate `'member'` **security field-visibility tier**, which is a different axis
(a typed access contract, not the membership noun):

- `Tier = 'public' | 'member' | SensitiveTier | 'secret'` and
  `Token = 'public' | 'member' | …` ([security/core.ts:41,55](../../src/security/core.ts#L41)).
  Semantics: a `member`-tier field is visible to a member view; a member view holds
  BOTH `'member'` and `'public'`, anon holds only `'public'`
  ([core.ts:6-10,241](../../src/security/core.ts#L6)).
- Surface if ever renamed to `'orgMember'`: ~34 `'member'` tokens across
  [registry.ts](../../src/security/registry.ts) scope arrays; the one
  `@sensitivity:member` schema tag ([schema.prisma:144](../../prisma/schema.prisma#L144),
  on `ToolStatus`); `level: 'member'` in generated
  [classifications.ts](../../src/security/generated/classifications.ts); parser
  guards ([scopes.ts:260](../../src/security/scopes.ts#L260), core.ts).

**Why deferred:** it's a security contract, **partly tsc-blind** (bare string
literals in scope arrays + `@sensitivity:` comment) — a rename needs the full jest
security suite (registry/strip/scope oracles) as the net, and carries real
over/under-grant risk if botched. Its own slice if done.

**Open question (🟡):** is a rename even wanted? `'member'` as a *visibility* tier
reads fine ("member-visible") and isn't the org-membership noun — it may
legitimately stay forever. Decide: rename to `orgMember` for dictionary purity, or
bless it as-is and record that in VOCABULARY. _(Phase 4 OQ-1)_

---

## 🔵 Aspirational — not built yet (enforced by policy / no data today)

- **Tool categories + per-level/per-category age gates** (10/13/21; Certified =
  category-based). `Tool` has no `category`, no age checks. Enforced by policy
  outside the software for now. _(VOCAB #2)_
- **Corporation / Organizational Partner Member** — no corporate partners today.
  Keep `Corporation`/`CorporationLead`/`CorporationMember` as scaffolding; when
  built, define the concept and qualify the bare `CorporationMember`. _(VOCAB #5)_

---

# Architecture / auth end-state — from the 2026-06-29 codebase audit

Provenance: a 2026-06-29 codebase architecture audit (recorded in git history; the
auth end-state detail lives in
[auth-consistency-analysis.md](../../../docs/security/auth-consistency-analysis.md)), distinct
from the vocabulary sweep above. **Everything else that audit flagged has
shipped** — the P0-B auth-consolidation buckets, the P1 near-neighbor fixes, P3-1
error-path (`apiError` + lint, #728), P3-2 logger (#727), P1-2/6/7/8, P2-1 Person
rename, P2-2 counterparty→trustedAdult (#734), and the GAP-1 program-roster leak.
These four are what remain.

## 🔴 Program → Instance → Event — 3-tier restructure (IN DESIGN, do NOT start code)

Domain is **definition → offering → occurrence** but the schema is 2-tier
(`Program` → `Event`, [schema.prisma:586](../../prisma/schema.prisma#L586)/[:702](../../prisma/schema.prisma#L702)).
**Decided:** insert `ProgramInstance` between them — `Program` = reusable definition,
`Instance` = one concrete offering, `Event` = today's leaf (attendance stays on
`Event`; `RSVP`/`Visit` do not move). Model name `ProgramInstance` in code (never bare
`instance`; `Session` is off-limits — NextAuth owns it).

**Core open decision:** because `Program` becomes a template, its children
(`ProgramParticipant` roster, `ProgramVolunteer`, `Fee`, `leadMentorId`, capacity,
dates) likely **move down to Instance** — you enroll in an offering, not a definition.
The per-child placement table is the heart of the design.

**Security ripple (large):** the `programsLed` session claim (auth-options / authClaims
/ next-auth.d.ts, added for the program-ops row gate) becomes `instancesLed`; the
event→program authorize hop (`access-resolvers`, `events/[id]` inline gate, the GAP-1
roster gate in `programs/[id]`) becomes event→instance→program. Full design proposal:
[PROGRAM_INSTANCE_RESTRUCTURE.md](../../../docs/designs/PROGRAM_INSTANCE_RESTRUCTURE.md);
**do not write code until the child-placement table + phasing are reviewed.**
Supersedes the P2-3 Event/session naming item (naming resolves as an output).

## 🟡 GAP-2 drift-guard — ban auth/route drift in CI (validators already armed)

The scope validators are **armed + green** ([scopeValidators.test.ts](../../src/security/__tests__/scopeValidators.test.ts),
#733): they prove every sensitive field is bound and every route grant resolves. The
**second half is unbuilt by choice** — a CI drift-guard that fails on any new
`getServerSession`/`authenticateRequest` import outside the wrapper libs
([lib/auth.ts](../../src/lib/auth.ts)), and any `src/app/api/**` route that calls
`prisma` without a registered policy. Today: 2 legit `getServerSession`
(`dev-personas`, `shop/tools`, both optional-session). Without the guard the IDOR/drift
class can regrow (it already went 2→6→2 once). Re-armable anytime.
Ref: [auth-consistency-analysis.md](../../../docs/security/auth-consistency-analysis.md) §9 Step 7.

## 🔵 `handler()` consolidation — the "one authorization rule" end-state

~13 of ~101 routes use the security `handler()` runtime; ~75 use `withAuth` (admission
only, no field stripping) with row-authorization hand-rolled inline. End-state:
`handler()` becomes the default, `withAuth` collapses into a degenerate `handler()`
(permissive `orderedView` → no-op stripper), `withCron`/`withWebhook`/`withKiosk` stay
the non-session front doors, `authenticateRequest` goes internal-only. This is
**consolidation, not a security gap** — sequence behind everything else.
Ref: [auth-consistency-analysis.md](../../../docs/security/auth-consistency-analysis.md) §4, §9 Steps 5–6.

## 🟢 Response envelope — phase 2 (success bodies)

Error responses route through `apiError()` + a lint guard (#728). **Success** bodies are
still ad-hoc (~547 raw `NextResponse.json`, varied shapes: `{data}`, `{household}`,
`{Person}`, …). Standardizing them is deliberately deferred to **ride the `handler()`
migration** (handler owns the success `envelope`), not a parallel rewrite. Ref: P3-1.

---

## Considered and dismissed (no drift — recorded so we don't re-audit)

- **RSVP** — `RSVP` / `RSVPStatus`; distinct from Visit (intent vs actual);
  consistent. (One-line dictionary note only: RSVP=intent, Visit=actual.)
- **BoardSettings vs AppSettings** — split documented inline in schema
  (money/membership policy vs deployment tz/locale). Clean.
- **EmergencyContact** — clear, well-commented; not-a-household-member invariant
  documented. (`conflictParticipantId` is Person-migration tail, not new.)
- **Audit / Error / Metric / Integration / Dev logs** — internal, self-describing.
- **Account / Session / VerificationToken** — standard NextAuth; only smell
  (`@map("participant_id")` + "user") is the SessionUser dedup item above.
- **AttestationResult / OrgMembershipStatus / ProgramPhase / EnrollmentStatus** —
  well-scoped status enums; no cross-layer drift. (Was `MembershipStatus`; renamed
  with the model in Phase 4 #735.)
- **`membership-ops/*` + `membership-audit/*` route/dir/nav paths — kept, not
  Org-prefixed (Phase 4 OQ-7).** Phase 4 Org-prefixed the model, price fields, shop
  path, and user copy but left these admin **ops-surface** paths as `membership-ops`
  / `membership-audit` (the model/prisma references *inside* those files did rename).
  Deliberate — renaming the dirs/routes/nav would cascade into `pageRegistry`, nav
  tests, and every internal `router.push`, for no user-visible gain. Recorded so
  nobody re-audits it as leftover drift.
- **Attendance "volunteer" / "youth" buckets** — `getFullAttendance` +
  `attendance/current` bucket live visitors by age + keyholder flag
  (`volunteer` = adult non-keyholder, `youth` = minor), NOT by real
  `ProgramVolunteer` / enrollment. **Won't-change:** it's the intended
  "adults-on-the-floor vs youth" **supervision** signal (already labelled
  "Volunteers/Adults" in the UI), and that age split is **safety-load-bearing** —
  the two-deep / unaccompanied-youth banner depends on `adult = !isYouth`. Do NOT
  "enrollment-ify" these buckets. (The separate `facility/trends` age-proxy
  *metric* WAS a real bug and was fixed independently.)
- **Security handler `{ Model: rows }` bag key vs `envelope`** — a stripper route
  returns its rows keyed by the **model name** (that drives field-tier stripping in
  `security/handler.ts`), then re-wraps under the route's `envelope` for the wire
  (e.g. `/api/shop/org-members` → `{ org-members: [...] }`). The bag key reading
  differently from the wire key is **intentional**, not a mismatch — do not "fix" it.
- **`student` / `youth` == non-lead** — checked, **NOT** a logic conflation. It
  lives only in vocabulary (`dependent` ≈ non-lead; old `student` ≈ minor);
  promotion allows a non-lead **adult** → lead (`my-household`). Behavior preserves
  the distinction. Recorded so nobody re-audits it as a bug.
