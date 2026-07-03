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

## 🟢 Retire "staff" (program sense) → Treehouse Volunteers

100% volunteer, no staff. Scrub "program staff" strings:
[my-programs/layout.tsx:15](../../src/app/my-programs/layout.tsx#L15),
[nav/todo-counts/route.ts:65](../../src/app/api/nav/todo-counts/route.ts#L65),
[programs/[id]/route.ts:72](../../src/app/api/programs/[id]/route.ts#L72),
[programs/[id]/volunteers/route.ts:38](../../src/app/api/programs/[id]/volunteers/route.ts#L38).
Umbrella = **Treehouse Volunteers**. _(VOCAB #7)_

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

## 🟢 Rename payment "certified" → "manual" (collides with tool certification)

`via: "certified"` / `MembershipProcess.certifiedById`
([payment.ts:117](../../src/lib/membership/payment.ts#L117),
[:236](../../src/lib/membership/payment.ts#L236),
[schema.prisma:352](../../prisma/schema.prisma#L352)) = payment **landed outside
Shopify** (recorded in QuickBooks), so the membership activates without a Shopify
order. NOT a comp — they paid, through another channel. **✅ Decision:**
- `via: "certified"` → **`via: "manual"`**
- `certifiedById` → **`manualPaymentById`**

Kills the tool-certification collision. Separately name the relief types (distinct
from manual payment): **Payment Plan** (installments, `isPaymentPlanRequested`) and
**Scholarship** (board comp, 0 code refs today) — one process handles either/both.
_(VOCAB #17)_

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

## 🔵 Aspirational — not built yet (enforced by policy / no data today)

- **Tool categories + per-level/per-category age gates** (10/13/21; Certified =
  category-based). `Tool` has no `category`, no age checks. Enforced by policy
  outside the software for now. _(VOCAB #2)_
- **Corporation / Organizational Partner Member** — no corporate partners today.
  Keep `Corporation`/`CorporationLead`/`CorporationMember` as scaffolding; when
  built, define the concept and qualify the bare `CorporationMember`. _(VOCAB #5)_

---

## 📖 Record-in-dictionary only (no code change)

- **Certification levels** — full ladder (No Dot/Red/Green/Yellow/Blue/Tool
  Certifier), color↔word synonyms, ranks, ages, DOF = "Defender of the Finger".
- **Volunteer taxonomy** — Treehouse Volunteer umbrella + Volunteer Family (A+B),
  Program Volunteer (C), attendance courtesy bucket (D). Never bare "volunteer".
- **Supervision terms** — Tripod (3 Members ≥9yo, Observable & Interruptible),
  Two Deep, Observable & Interruptible. ("dedicated" = attentive supervision;
  ignore in code, not enforceable.)
- **Attendance pipeline** — scan → RawBadgeLog → Visit → attendance; "check-in" =
  action, "attendance" = view.
- **Shop vs Facility** — distinct billable domains; shop = makerspace + tool
  safety, facility = building/attendance.
- **Program roles** — Program Leader / Program Volunteer. "Mentor" is NOT a
  separate role (= Leader or Volunteer; program-specific "mentor" language is
  external). "Core Volunteer" = the authorized subset who can run the program
  (legal-authority rules are organizational, out of software scope). "Instructor"
  is tool-only; "program instructor" banned.
- **MembershipProcess = "application"** — an intake process, called "application"
  because it includes a BG check and can be rejected.
- **Integration vendors** — **Averity** (background check; aka "VERITY"), **Zoho**
  (e-sign / import), **Shopify** (payment). Proper nouns, record for reference.
- **Visitor vs `Visit`** — accepted near-collision (non-member person vs
  attendance record); no rename.
- **Declared Adult** (`isDeclaredAdult`) — self-asserted "25+", no DoB captured
  (PII minimization); a subset of Adult (18+). 25 = age past which no program-run
  restriction (Close-in-Age safe line).
- **Membership Year** — canonical; Sept 1–Aug 31 policy dates, but
  `membershipYearBoundary` stays configurable by design.
- **Emergency Contact vs Trusted Adult** — intersecting, not identical; may be the
  same person; don't merge. Emergency Contact = who we call; Trusted Adult = who
  may pick up / transport / be alone with a child.
- **Single facility** — check-in only at the one Treehouse Facility; multi-location
  not on the roadmap (`RawBadgeLog.location` free-text is fine as-is).
- **Treehouse Card** — any card on the Treehouse EIN (future financial rules).

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
- **AttestationResult / MembershipStatus / ProgramPhase / EnrollmentStatus** —
  well-scoped status enums; no cross-layer drift.
- **Attendance "volunteer" / "youth" buckets** — `getFullAttendance` +
  `attendance/current` bucket live visitors by age + keyholder flag
  (`volunteer` = adult non-keyholder, `youth` = minor), NOT by real
  `ProgramVolunteer` / enrollment. **Won't-change:** it's the intended
  "adults-on-the-floor vs youth" **supervision** signal (already labelled
  "Volunteers/Adults" in the UI), and that age split is **safety-load-bearing** —
  the two-deep / unaccompanied-youth banner depends on `adult = !isYouth`. Do NOT
  "enrollment-ify" these buckets. (The separate `facility/trends` age-proxy
  *metric* WAS a real bug and was fixed independently.)
