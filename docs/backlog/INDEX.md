# Backlog Index (buckets)

> **Provenance:** validation evidence (chip outputs, file:line-cited code checks at base `5528270d`, raw GH dumps) lives in `backlog/sources/` on branch `claude/checkin-backlog-baseline-b0ef5a` — not copied here. Chip ids (V1–V7, A–H) and `sources/...` paths refer to that branch.

Status: **APPROVED baseline (v2, 2026-07-20).** Synthesized from all sources (chips A–F + D2),
deduped, bucketed, tagged. Buckets + coverage + readiness + GH associations signed off (Q5).
Next phase = per-item debate → eventually open GH issues (not yet).

## Legend
- **Origin**: PORT (exists in an Inventory app) · CREATE (net-new) · ENHANCE (extend built checkin) · FIX (open bug) · DECISION (keep/kill or policy call)
- **Readiness** (design→dev pipeline state ONLY):
  - `NEEDS-DESIGN` · `IN-DESIGN` (doc exists, don't-start) · `READY-FOR-DEV` · `VERIFY` (needs code check) · `DECISION` (product/policy answer needed) · `COND` (genuinely gated on an external trigger — see note)
  - **NOTE:** "deferred from v1 launch" is NOT a readiness. Items cut from v1 scope are still wanted; their readiness reflects design/dev state, not the old launch call. Only `COND` marks a real trigger-gate (e.g. "adopt once unattended").
- **Src**: chip letter(s). **GH**: existing issue handle (open/closed) or `none`.
- **Size**: S/M/L/XL(epic). IDs are bucket-prefixed and stable for later reference.
- **Workaround**: the current manual workaround if the feature is missing (affects urgency). `?` = not yet assessed · `none` = no workaround, higher pain.

**When an item is confirmed done/built: DELETE its row** from the bucket table and add a one-liner to § Dropped — no struck-through or verbose "BUILT-DROP" rows (keeps the buckets clean).

Legend of drops: see [§ Dropped — confirmed built](#dropped--confirmed-built-not-backlog) and each source file in `sources/`.

---

## 1. Membership & Household  (prefix M)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| M1 | **Ongoing-membership status machine**: add GRACE + INACTIVE + scheduled active→grace→inactive (OrgMembership.status is NONE/ACTIVE/REVOKED/DENIED only). NOTE: distinct from the built `OrgMembershipProcess` *application/renewal* lifecycle (generated/lifecycle/membership.md, ends at ACTIVE/ARCHIVED) — this is the missing *ongoing* layer on top. | ENHANCE | NEEDS-DESIGN | L | board tracks manually (QB/Shopify) | B,E,generated | #1152 (open, viz) |
| M2 | Membership **state-maintenance cron** (compliance eval + warn-only violations dashboard; never auto-terminate) | CREATE | NEEDS-DESIGN | M | manual board review | B | none |
| M3 | Stale-application lifecycle (60d archive / 180d purge-if-never-active) | CREATE | NEEDS-DESIGN | M | ? | B | none |
| M4 | **Archive Family** (`Household.archivedAt`, exclude from active queries) — distinct from membership REVOKED | CREATE | READY-FOR-DEV | S | ? | B | none |
| M5 | Cascading removal on revoke/deny (pull enrollments + pickup auths + list subs) | CREATE | NEEDS-DESIGN | M | remove enrollments/subs by hand | B | none (depends CM1) |
| M6 | Age-based **individual agreement per ≥18 child** (child-of-signer, not spouse) — today one household-level agreement | ENHANCE | NEEDS-DESIGN | M | ? | B,E | none |
| M7 | "Students ≥18 as of Sept 1" report — current AND next member-year | CREATE | READY-FOR-DEV | S | none | B | none |
| M8 | Age-based family cap: <25 same-address may stay; ≥25 own family | CREATE | DECISION | M | handle case-by-case | B | none |
| M12 | **Address UX** — street-address autocomplete/validation | ENHANCE | READY-FOR-DEV | S | type address by hand | F | #315 (open) |
| M13 | Settings PUT bug: one env-rejected field 400s all membership settings | FIX | READY-FOR-DEV | S | save fields one at a time | F | #1130 (open) |
| M14 | Membership-process **visualization** for audit/ops | CREATE | NEEDS-DESIGN | M | ? | F | #1152 (open) |
| M15 | **Enforce certifier ∈ member-family invariant** at API/seed — HIGH-RISK (a certifier can grant tool use = one of the org's largest risk items) | ENHANCE | READY-FOR-DEV | S | ? | F | #164 (open) |
| M16 | BLOCKED membership — **PARTIAL**: the alert is fixed (`MembershipFlowStepper` shows "needs attention, team notified" — board-override-only). Remaining: right-column status card (`page.tsx:985-992`) has NO BLOCKED case → still shows the generic #879 "follow the steps" card, now CONTRADICTING the alert. Add an `inStatus==="BLOCKED"` branch. **#879 closed but never fixed.** | FIX | READY-FOR-DEV | S | the red alert already tells them (card just contradicts) | D2,verify | #879 (closed — NOT fixed) |
| M18 | **Person/record merge (#1103 LIVE_PERSON) leaves a valid but non-controlled email** — contact-integrity risk (address resolves, nobody owns it). On merge, invalidate/reassign the orphaned address. Ties RB10 sole-contact residual. (Confirmed person-merge, not household-merge.) | FIX | NEEDS-DESIGN | S | ? | owner,V1 | none |
| M19 | **Hide archived households from the many views** that don't filter them yet (follow-on to M4/#959 soft-archive — archive blocks activity but many read surfaces still show archived families). | ENHANCE | NEEDS-DESIGN | S | ? | owner | none |
| M20 | **View membership agreement as PDF, view-only** — read the agreement without triggering a Zoho Sign session (applicants previewing before committing + members re-reading their reference copy). Design calls: static current-template PDF vs the person's own signed copy (Zoho download); ties CM12 templates + CM13 policy library | CREATE | NEEDS-DESIGN | S | ask board / start-then-abandon a Zoho sign flow | owner | none |
| M21 | **Alumni pipeline** (Q74): students age out → alumni relationship worth modeling — keep the door open for the classic alumni→mentor return (list membership, status distinct from lapsed member, SA1 BG trigger already fires when they return as adults). Scope TBD | CREATE | NEEDS-DESIGN | M | nothing — alumni just disappear | owner | none |

## 2. Programs & Enrollment  (prefix P)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| P1 | **Program → Instance → Event 3-tier restructure** (insert ProgramInstance; move roster/vols/fee/lead/capacity/dates/age-limits down) | ENHANCE | IN-DESIGN | XL | use flat Program model (no instance tier) | B,C,E,F | #155, #152 (open) |
| P2 | **Seat reservation / capacity holds** (temp hold, expiry, convert to enrollment) — no schema today | CREATE | NEEDS-DESIGN | M | ? | B | none |
| P3 | **Waitlist** for full programs (notify on capacity; queue-vs-notify-all open Q) | CREATE | NEEDS-DESIGN | M | ? | F | #942 (open) |
| P4 | **Auto-close enrollment** when pending+active ≥ max | CREATE | READY-FOR-DEV | S | ? | F | #82 (open) |
| P5 | Program **archive / un-archive** (`Program.phase` has no ARCHIVED) | ENHANCE | READY-FOR-DEV | S | ? | B | none |
| P6 | Shopify **auto-archive** finished programs + empty-category error warnings | CREATE | NEEDS-DESIGN | M | ? | B | none |
| P7 | **Shopify↔system capacity reconciliation** — gap CONFIRMED (V2): cap-FIELD edit reconciles as delta (`adjustProgramInventory`), but a **manual comp-add does NOT bump Shopify max** (no inventory call on comp create); capped↔uncapped warns-only. Highest-impact op loss | ENHANCE | NEEDS-DESIGN | M | ? | B,V2 | #625 (open, adjacent) |
| P8 | Program-leader **custom enrollment "key info" fields** (custom-question schema) | CREATE | NEEDS-DESIGN | M | ? | B | none |
| P9 | **Copy a program** (carry desc/doc links year-to-year, re-price) | CREATE | READY-FOR-DEV | S | recreate the program by hand | F | #156 (open) |
| P10 | Time-limited **member exclusivity** ("member-visible until date X" — not binary Member-Only) | ENHANCE | NEEDS-DESIGN | S | ? | F | #152 (open) |
| P11 | Program removal: 15-day warning + leader **Pause** (30d, once/yr); privacy-preserving "Incomplete Membership" label | CREATE | NEEDS-DESIGN | M | ? | B | none |
| P12 | Program-removal enforcement (stale/grace/expiry, scheduled) | CREATE | NEEDS-DESIGN | M | remove stale enrollments by hand | B | none (overlaps M5) |
| P13 | Manual-only programs (no Shopify limit; payment follows enrollment) | CREATE | VERIFY | S | ? | B | none |
| P14 | **Checkin → public Google Calendar feed** (Q83): programs/events created here publish to the website's Google Calendar. MUST include **display rules for cancellations + last-minute moves** (weather reactions etc.) so the public view never gaslights people — a changed event shows AS changed, not silently swapped. (Parked PR #952 = .ics export + template links only, NOT a live feed.) Ties CM11, CM14, P24 | CREATE | NEEDS-DESIGN | M | hand-edit the Google Calendar | B,owner | none |
| P15 | Volunteer↔instance assignment (leader assigns; volunteer self-removes) | VERIFY | VERIFY | S | ? | B | none |
| P16 | Youth enrollment rules (limit / parent-notify / slot-reserve / disallow?) | DECISION | DECISION | M | ? | F | #167 (open) |
| P17 | Staff-household enrollment ban — **server-side enforcement** (UI-only today) | ENHANCE | READY-FOR-DEV | S | ? | D2 | #1009-ref |
| P18 | Dead routes: wire-or-delete `/publish` (#476) + `/settings` (#477); port lost validation/guards | FIX | READY-FOR-DEV | S | ? | F | #476, #477 (open) |
| P19 | Program-date **time display** off-by-one (UTC/local) | FIX | READY-FOR-DEV | S | ? | F | #1149 (open) |
| P20 | **My-Programs roster surface** for leads — roster + contact, attendance summary, stats, CSV (net-new read surface beyond the inbox; ties GC-ROLES/PL duties; parked partial PR #964, scope source) | CREATE | NEEDS-DESIGN | M | ? | PR#964 | #964 |
| P21 | **T-shirt size on Person** — size field for participants + adults (some parents too), with **staleness/refresh policy** (size set too long ago → re-confirm reminder; refresh window likely age-based since youth grow — open design Q) | CREATE | NEEDS-DESIGN | S–M | collect sizes by hand (forms/spreadsheet) | owner | none |
| P22 | **Program "issues t-shirts" flag + missing-size ops surface** — program attribute; flag gaps to families; dashboard for ops/program leads (+assistant leads) of students in shirt-issuing programs with no/stale size (fits the existing compliance-dashboard `peopleMissingDob` + nav todo-count pattern) | CREATE | NEEDS-DESIGN | M | chase sizes over email | owner | none |
| P23 | **Program add-on offers → Shopify checkout (deadline-gated)** — design as a GENERIC "buy N by deadline so we can order" pattern; instance 1 = **t-shirts** (students AND adults, N comped per student + paid extras, comp policy TBD); instance 2 = **meal fees for parents at far-away competitions** (Q41). Reuses program↔Shopify variant + webhook plumbing | CREATE | NEEDS-DESIGN | M–L | manual order collection + side spreadsheet to vendor | owner | none |
| P24 | **Treehouse-wide / cross-program events** — an org-level event can appear on one or MORE program calendars (e.g. library visit with reps of 3 teams). Breaks the event-belongs-to-one-program assumption → event↔program many-to-many or org-event + program associations; affects attendance association + who's notified/RSVPs. Model it inside the P1 restructure rather than bolt-on; ties P14 calendar | ENHANCE | NEEDS-DESIGN | M | duplicate the event per program by hand | owner | none |
| P25 | **Year-over-year team rollover** — a team is an ongoing program run yearly (Q47): on new-year creation, **auto-carryover of participants** + **"last year's members get first dibs" priority-enrollment window** + **board prices the new year**. Extends P9 copy + P1 restructure (team = persistent entity, year = instance) | CREATE | NEEDS-DESIGN | M | recreate + re-enroll by hand, dibs by email | owner | none |
| P26 | **External FIRST registration tracking** — enrollment here ≠ registered with FIRST (Q48). Phase 1: per-program **links to external registration** + P22-style gap dashboard ("enrolled here, not registered there"). Phase 2 ambition: **sync/expose FIRST registration state** in checkin. Texas wrinkle: students AND mentors must register with FIRST-NH **and** FIRST-Texas — two external registrations per person | CREATE | NEEDS-DESIGN | M | chase families by email, track in heads | owner | none |
| P27 | **Trip mode — temporary access expansion for off-site events** (Q44/Q54): during a trip window, chaperones/leads get the P20 roster surface incl **emergency contacts + allergies** on their phone; access is time-boxed to the event, then auto-revoked. Needs think-through (who grants, scope, audit). Ties P20, SA7, RB8 row-visibility | CREATE | NEEDS-DESIGN | M | printed sheet in a binder | owner | none |
| P28 | **Program "requires signed waiver" feature** (Q61): a program can require a waiver signed at/for enrollment (summer camps are big enough to need one); gate enrollment on it + track who signed (Zoho pattern like the membership agreement). Trips explicitly do NOT need one (covered by membership agreement; non-members don't come). Ties CM12 templates | CREATE | NEEDS-DESIGN | M | paper waivers in a folder | owner | none |

## 3. Attendance & Facility  (prefix AT)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| AT1 | **Attendance inference** confidence / ambiguity / reconciliation **state** (association is deterministic single-match today) | ENHANCE | NEEDS-DESIGN | L | ? | B,E | none |
| AT2 | Attendance **ambiguity resolution** (overlapping programs; admin resolves; report flag; 30d reminder) | CREATE | NEEDS-DESIGN | M | ? | B | none |
| AT3 | **Visit management for staff.** (a) A user can insert their own past visit but CANNOT edit it once inserted — no edit path for an existing visit (self or others), insert-only. (b) Whether **ops / program-lead can ADD a visit for others** is unverified — needs a code check. | ENHANCE | NEEDS-DESIGN + VERIFY(b) | S | delete + re-insert (if delete exists) | B,E,owner | none |
| AT4 | **Volunteer-hour derivation from assignments** (today = residual present-but-not-enrolled, not from VolunteerDesignation) | ENHANCE | NEEDS-DESIGN | M | ? | B,E | none |
| AT5 | Hour **correction + manual entry**, incl. **user self-correction of their own hours** (confirmed live gap — hours are read-only today; attendance *visits* are self-backfillable but derived/volunteer *hours* are not). Scoped (self / leader / ops), audited. | CREATE | READY-FOR-DEV | S | ask leader/ops/admin to correct | B,owner | none |
| AT6 | **Two-deep compliance** (block last adult leaving lone student; 60s delay) — child-safety GAP | CREATE | NEEDS-DESIGN | M | ? | B,E | #300 (open, bug) |
| AT8 | Offline kiosk store-and-replay + offline banner | VERIFY | VERIFY | M | ? | B | none |
| AT9 | Force-close **race** (updateMany under per-participant lock → check-in survives close) | FIX | READY-FOR-DEV | S | ? | F | #254 (open) |
| AT10 | `isMinor(null)→ADULT` fails open in two-deep (unknown-DOB counted as adult) | FIX | READY-FOR-DEV | S | ? | F | #300 (open) |
| AT11 | **Badge-print tracking** — `BadgePrint` model + facility-ops report of who has/hasn't had a badge printed in year X (net-new; parked partial PR #962, scope source) | CREATE | NEEDS-DESIGN | S | ? | PR#962 | #962 |
| AT12 | **Admin hour-correction review screen** — surface how often self/hour corrections happen + let admins review them, NOT buried in the audit log (companion oversight surface to AT5) | CREATE | NEEDS-DESIGN | S | read the audit log by hand | owner | none |
| AT13 | **Visit-edit privilege UI/API mismatch** — `facility/visits` PATCH/DELETE allows `isBoardMember`+`isSysadmin`, but `facility-ops/visits` page gates `isSysadmin` only → board can correct visits via raw API but has no UI page | FIX | READY-FOR-DEV | S | board hits the API directly | V3 | none |

## 4. Safety & Compliance  (prefix SA)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| SA1 | **BG automation remainder**: cron cohort-open, consent link/email, supplier affirmation, blanket-stamp→per-adult migration, enforcement/grace blocking (Phase 3 consent+queue shipped) | ENHANCE | NEEDS-DESIGN | L | ? | B,D2 | none (board-gated by SA5) |
| SA3 | **Scheduled household-composition sweeps** — recompute BG/safety obligations as membership/ages change: (a) flag a household that has lost its only background-checked adult (NO_CHECKED_ADULT → youth now uncovered); (b) when a youth turns 18, recompute their own BG/agreement obligations. Catches gaps that emerge over time, not just at intake. | CREATE | NEEDS-DESIGN | M | ? | B | none (needs SA1 per-adult predicate) |
| SA4 | BG-alert cascade (passive drift, program-lead alerts, escalation/re-notify) | ENHANCE | NEEDS-DESIGN | M | ? | B | none |
| SA6 | **Delete DoB for all adults** (deep delete — no audit residue) | CREATE | DECISION | M | ? | F | #1165 (open); #287 (closed, ≥25) |
| SA7 | Front-desk/keyholder access to **allergies** where food served (grant or close) | DECISION | DECISION | S | ? | F | #714 (open) |
| SA9 | **Families see their own tool certs** (Q71 — "probably yes"): household/member view of each person's tool levels (data is public-by-design already; this is a member-facing surface, not a new grant) | CREATE | READY-FOR-DEV | S | ask at the desk / check the posted board | owner | none |
| SA10 | **Cert-upgrade request** (Q71): a member proposes "I think my X cert should be upgraded" → tags/notifies that tool's certifiers to schedule the review. Lightweight queue, not a workflow engine | CREATE | NEEDS-DESIGN | S–M | ask a certifier in person | owner | none |

## 5. Finance — Receipts & Reimbursement  (prefix FR)   ·  PORT epic (receipt-app + ocr-function)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| FR1 | Receipt intake & capture (upload + file-hash dup detection; optional gmail-inbox monitor) | PORT | NEEDS-DESIGN | L | ? | A,B | none |
| FR2 | **OCR** interpretation (ocr-function; Claude SDK) — port with FR1 | PORT | NEEDS-DESIGN | M | ? | A,B | none |
| FR3 | Receipt approval/reimbursement **state machine** (approve/reject/review/retry/discard/resubmit). **Port requirement (Q86):** reimbursement request = part of the receipt-submission flow, and the **submitter must see their own status** ("did I get paid back?") — believed in the port's submitter-review states, VERIFY it survives the port | PORT | NEEDS-DESIGN | L | email/paper + ask the treasurer | A,B,owner | none |
| FR8 | **Card-statement ↔ receipt reconciliation** (Q87): match card-statement transactions against received receipts → "which transactions still lack a receipt" chase list. Today: by hand + QB reconcile function (+ printing the statement when bad). NOT in the Inventory port — net-new companion to FR1 | CREATE | NEEDS-DESIGN | M | hand-match against QB reconcile / printed statement | owner | none |
| FR4 | Tax explanation / tax-exception handling | PORT | NEEDS-DESIGN | M | ? | A,B | none |
| FR5 | In-kind donation identification (shares receipt system) | PORT | NEEDS-DESIGN | M | ? | A,B | none |
| FR6 | Backorder/preorder deferral + receive queue | PORT | NEEDS-DESIGN | M | ? | A,B | none |
| FR7 | `Fee`/`FeePayment` dead schema — keep/kill decision (built for PL/board tracking, never wired) | DECISION | DECISION | S | ? | F | #354 (open) |

## 6. Finance — Expense & QuickBooks  (prefix FE)   ·  PORT epic (expense-app)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| FE1 | Expense + line-item model; per-line **owner approval** workflow | PORT | NEEDS-DESIGN | L | ? | A,B | none |
| FE2 | Budget owners; owner↔PN associations; owner-conflict resolution | PORT | NEEDS-DESIGN | M | ? | A,B | none |
| FE3 | **QuickBooks posting** + account mapping + vendor mapping/normalization + ambiguity resolution (heavy external coupling) | PORT | NEEDS-DESIGN | XL | ? | A,B | none |
| FE4 | Capital-asset queuing / identification / depreciation cycle. **NET-NEW beyond the port** (Q66): closing the loop per asset — assign an **asset number**, log it in **QB**, and **remind finance to put the sticker on the physical item** — an endpoint that doesn't exist in Inventory yet | PORT+CREATE | NEEDS-DESIGN | M | ? | A,B,owner | none |
| FE5 | QuickBooks **drift detection & reconciliation** (external edits to system-originated entries) | PORT | NEEDS-DESIGN | M | ? | A,B | none |
| FE6 | Membership/plan payment → QuickBooks sync (primary adult; conflict → Financial Ambiguity Record; retry→manual queue) | PORT | NEEDS-DESIGN | L | ? | B | none |
| FE7 | **Shop-hour fee → QB inter-class journals** (Q49, concretizes GC-PROGRAM-FINANCE): a base **per-hour fee charged to programs** (+ surplus for shop-using programs) virtually hits each program's P&L as **real QuickBooks journals between classes**. Checkin already has the hours; given **hourly rates + application rules** it could initiate the journals. **Cadence: journaled MONTHLY** (Q88). (Owner: more nuances exist, not yet specified) | CREATE | NEEDS-DESIGN | M–L | hand-built QB journals | owner | none |
| FE8 | **Budget-vs-actual status view** for program leads / assistant leads / program treasurer (Q62): approved operational budget + up-to-date actual expenses → live budget-status per program. **Cadence (Q88): semi-rolling/monthly — receipts presentable semi-live as they land, building-fee journals monthly; leads ask per-PROGRAM, not per-calendar-period.** View-only slice — REVIVES part of the parked "Program Budgets" (lifecycle engine stays consciously-not-modeled); depends on expense data landing (FE1–FE3) + FE7 | CREATE | NEEDS-DESIGN | M | treasurer's spreadsheet | owner | none |

## 7. Finance — Donations  (prefix FD)   ·  PORT epic (bulkdonation-app, income-app)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| FD1 | **Benevity** bulk-import + dedup + comment-rule engine + restricted-condition mapping + GL account map | PORT | NEEDS-DESIGN | L | ? | A,B | none |
| FD2 | Disbursement holds + resubmit; disbursement events/snapshots | PORT | NEEDS-DESIGN | M | ? | A | none |
| FD3 | Donation entry: online (Shopify), check/cash [board], in-kind [ops]; auto donation-receipt email | PORT | NEEDS-DESIGN | M | ? | A,B | none |
| FD4 | Income-app **QB reconciliation + conflict resolution** on already-ingested Shopify data (reuse s-read) | PORT | NEEDS-DESIGN | M | ? | A,B | none |
| FD6 | **Team sponsorship intake** — a company sponsors a specific team, often by **check** (Q40): income-intake gap — record, receipt, and **allocate to that team/program**. Adjacent to FD1 restricted-condition mapping + FD3 check/cash entry, but the per-team allocation leg is net-new | CREATE | NEEDS-DESIGN | M | check goes to QB by hand, allocation in heads | owner | none |
| FD7 | **Year-end giving statement** (Q75 — "decent idea"): annual per-donor tax summary of all donations that year. Natural once FD1/FD3/FD6 intake lands | CREATE | NEEDS-DESIGN | S | hand-built letters | owner | none |

## 8. Catalog & Inventory  (prefix CI)   ·  PORT epic (global-catalog-app, local-inventory-app, workflow-mapping-app)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| CI1 | **Global catalog**: GTIN items, categories, vendor-alias references, 3-pass matcher, proposals/supersession, provisional allocation, conversion challenges | PORT | NEEDS-DESIGN | XL | ? | A,B | none |
| CI2 | **Org inventory**: locations, receive queue, delta apply, merge-conflict resolution, provisional resolution | PORT | NEEDS-DESIGN | L | ? | A,B | none |
| CI3 | Receipt line-item → **part association** (auto + manual exceptions); UoM conversion/quantity challenge | PORT | NEEDS-DESIGN | L | ? | A,B | none |
| CI4 | **workflow-mapping** orchestrator (receipt→catalog→inventory→expense glue; collapses in monolith) | PORT | NEEDS-DESIGN | M | ? | A | none |
| CI5 | Cross-system catalog sync (local↔global federation) | PORT | NEEDS-DESIGN | M | ? | A,B | none |

_Note: FR+FE+CI (+CI4 glue) are ONE dependency-chained pipeline — little value piecemeal (chip A). FD1 (Benevity) and FD4 (income QB-recon) are the two independently shippable finance ports._

## 9. Commerce & Payment Reconciliation  (prefix CO)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| CO1 | **Shopify member-segment pricing** (#929): auto-managed customer segment gates who redeems member/volunteer variants | ENHANCE | IN-DESIGN | L | ? | C,D2,F | #270, #278 (open) |
| CO2 | **Validate payment webhook** before activation: amount/discount/product/code gate (`Membership_Process_ID` customer-controlled) | FIX/ENHANCE | READY-FOR-DEV | M | honor system (the current state) | C,D,D2,F | #278 (open, security) |
| CO3 | Guest-checkout failure: member charged full price silently — nudge / post-purchase refund path | ENHANCE | DECISION | S | ? | C | none |
| CO4 | In-flight-checkout cutover: old cart permalinks never expire; dual variant-id recognition + deprecation window | ENHANCE | NEEDS-DESIGN | S | ? | C | none |
| CO5 | **DiscountCodeRule registry** (board-managed coupon eligibility rules) | CREATE | NEEDS-DESIGN | M | ? | D2 | #1085-ref |
| CO6 | Pricing **drift auto-check**: our pricing settings vs Shopify actual (discounts/timing) | CREATE | NEEDS-DESIGN | M | ? | C,F | #625 (open) |
| CO7 | Shopify config-drift reconciliation (dev↔prod variant/config) + archive-status contract (#955) | CREATE | NEEDS-DESIGN | M | ? | D2 | none |
| CO8 | **Remove legacy 2-variant product-shape references** — the 2-variant shape is a problem; lingering references = a bug (not a keep/kill call) | FIX | READY-FOR-DEV | S | ? | F | #975 (open) |
| CO9 | Real-dev-store checkout testing promoted optional→required before segment-pricing phase 2 | CHORE | READY-FOR-DEV | S | ? | C | none |

## 10. Communications & Mailing Lists  (prefix CM)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| CM1 | **Mailing-list auto-sync** (Google Group decided): add member+family on activation, remove on revoke — foundational (needs CTFRCA Google account + integration design) | CREATE | NEEDS-DESIGN | L | ? | B,D2 | #943 (open, adjacent) |
| CM2 | Rule A — minimum adult coverage (auto re-add + notify); daily job | CREATE | NEEDS-DESIGN | M | ? | B | none (dep CM1) |
| CM3 | Ghost / data-integrity detection (weekly Google-Group scan; unknown-email vs expired; board report + bulk-remove UI) | CREATE | NEEDS-DESIGN | M | ? | B | none (dep CM1) |
| CM4 | Cascading list cleanup on program/membership removal | CREATE | NEEDS-DESIGN | S | ? | B | none (dep CM1, M5) |
| CM5 | ~~Scheduled compliance/reminder engine — email sends gutted~~ — **ACK'd, larger fix underway by another dev; OUT OF SCOPE this session** | FIX | (external) | — | ? | B,E | none |
| CM6 | **Per-program Google Groups, auto-managed** (Q55 spec): group address(es) become **fields on Program** — up to 3 lists per team: **team** (parents+students+volunteers), **parents-only**, **mentors-only** — checkin auto-adds/removes on enrollment change. Some teams use **Slack** instead (everyone added) — same membership feed, different connector. Youth auto-included | CREATE | NEEDS-DESIGN | M | leads maintain Google Groups by hand | B,owner | none |
| CM7 | Email deliverability / unreachable-address detection (bounce signals) | CREATE | NEEDS-DESIGN | S | ? | B | #928 (closed, partial) |
| CM8 | **Program-creation email controls**: opt-in per leader + only active-membership recipients + resend-rate batching | ENHANCE | READY-FOR-DEV | M | ? | F | #1153 (open) |
| CM9 | **Batch large emails** (chunks, ≤5/sec to respect Resend limit) | ENHANCE | READY-FOR-DEV | S | ? | F | #1154 (open) |
| CM10 | **Newsletter enroll**: household leads opted-in by default, opt-out in comm settings | CREATE | READY-FOR-DEV | S | ? | F | #943 (open) |
| CM11 | **Event cancel notifies** registered participants (RSVP path ripped out — rescope) | FIX | READY-FOR-DEV | S | ? | F | #472 (open, rescope) |
| CM12 | Agreement/receipt **template management** [board] (Membership, Waiver, Key-Vol, Dual-Rel, Donation-Receipt) | CREATE | NEEDS-DESIGN | M | ? | B,C | none |
| CM13 | **Policy library in-app** — all org policies (source of truth = Google Drive) + bylaws + a procedure or two, visible + linked from the app. Curated link list (board-manageable, not a doc mirror); design calls: where it lives in nav, member-vs-public visibility, hardcoded vs settings-managed links | CREATE | NEEDS-DESIGN | S | hunt Google Drive / ask board | owner | none |
| CM14 | **Prospect path** (Q77): prospective families log in + subscribe to newsletter + get notified of programs — pre-membership account tier; open house = an event on the **public calendar**. Depends on newsletter (CM10) + public-facing calendar (P14-adjacent) landing first | CREATE | NEEDS-DESIGN | M | interest lives in someone's inbox | owner | none |

## 11. Platform, Admin & Automation  (prefix PL)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| PL1 | Aggregate **exception queue** (broader than #905 MVP: stuck processes + failed sends + mismatches) | ENHANCE | NEEDS-DESIGN | M | ? | B,C | none |
| PL2 | **Audit logging of PII reads** + reason field (today CREATE/EDIT/DELETE only, no READ, no reason) | ENHANCE | NEEDS-DESIGN | M | ? | B,E | none |
| PL3 | Audit-log event entities as **clickable links** | ENHANCE | READY-FOR-DEV | S | ? | F | #1151 (open) |
| PL4 | Program-leader **time-scoped contact access** (active-participant window + N days after) | ENHANCE | NEEDS-DESIGN | M | ? | B,C | none |
| PL5 | **Auto-purge cron** for disposed/expired data (manual one-click disposal only today) | CREATE | NEEDS-DESIGN | M | ? | D2 | #913-ref |
| PL6 | Lifecycle: transactional outbox / DB CHECK constraints / `classify` badge + SQL view (was decided-deferred architectural) | ENHANCE | COND | M | ? | C | none (adopt when scale/observability needs it) |
| PL7 | s-read FUTUREWORK: projection DLQ, replay/reset-watermark admin ops, alarm wiring, in-VPC migrate-runner | ENHANCE | COND | M | ? | C | none (#237 prod-creds closed by hand; rest = FUTUREWORK) |
| PL8 | **Orphan Student Alerts** (CUJ 7.5): dashboard alert for unclaimed parent accounts | CREATE | READY-FOR-DEV | S | ? | C,D | none |
| PL9 | SWR / data-fetching migration tail (Phase 7 ~30 files); resilient-load rollout | CHORE | READY-FOR-DEV | M | ? | C | none |
| PL10 | Index page: command palette (Cmd-K), dynamic detail results, keyboard nav (nice-to-have) | CREATE | NEEDS-DESIGN | M | ? | C | none |
| PL11 | Test-runner split Jest/Vitest (#228) [monorepo conversion #214 done, Lambda infra #235 done] | CHORE | READY-FOR-DEV | M | ? | C,F | #228 (open); #214, #235 closed |
| PL12 | Dev tooling: `+ new persona` creation; dev-instance macro set; sysadmin-persona impersonation | ENHANCE | READY-FOR-DEV | S | ? | C | none |
| PL13 | Test coverage → ~80% (Phase 4 remaining 53 pages; shared RTL fetch/session helper prereq) | CHORE | READY-FOR-DEV | M | ? | C | #393 (closed) |
| PL14 | **Staleness auto-notification framework** — registry-driven daily household nudges + weekly board digest for aging renewals/trusted-adults/broken-emails (net-new; distinct from external CM5; parked partial PR #958, scope source) | CREATE | NEEDS-DESIGN | M | ? | PR#958 | #958 |
| PL15 | **Annual org metrics report** (Q62): member-family count, total participant count, volunteer count, volunteer hours — the numbers the board hand-builds every year, from data checkin already has | CREATE | READY-FOR-DEV | S | hand-count from queries/exports | owner | none |
| PL16 | **Org task/todo board** (Q73): "here's what the Treehouse needs done" — one-time AND repeating tasks volunteers can see/claim. Lightweight chore board, not project management | CREATE | NEEDS-DESIGN | M | word-of-mouth / whiteboard | owner | none |

## 12. Auth, RBAC & Security  (prefix RB)  — one item per proposed role (Q3)

| id | item | origin | readiness | size | Workaround | src | GH |
|----|------|--------|-----------|------|----|-----|-----|
| RB1 | Role: **Program Treasurer** (budget-owner / line-item approval) — is it a role? what does it deserve? | CREATE | DECISION | M | ? | B,C | none |
| RB2 | Role: **Finance** | CREATE | DECISION | S | ? | B | none |
| RB3 | Role: **Operations (Ops)** | CREATE | DECISION | S | ? | B | none |
| RB4 | Role: **Catalog Manager** | CREATE | DECISION | S | ? | B | none |
| RB5 | Role: **Key Volunteer** (non-RBAC; assignment → triggers contract signing) | CREATE | NEEDS-DESIGN | M | ? | B | none |
| RB6 | Role: **Assistant Lead** (attendance/roster + move meetings; NOT settings/pricing/enrollment) | CREATE | NEEDS-DESIGN | M | ? | C,D2 | #437-ref |
| RB7 | **Admin role ambiguity** 🔴 ("admin" = isSysadmin some files, +isBoardMember others) — resolve, security-sensitive | ENHANCE | NEEDS-DESIGN | M | ? | C | none |
| RB8 | Declarative **row-visibility** enforcement (query-side), complements field-tier stripping (has shipped real leaks) | ENHANCE | NEEDS-DESIGN | L | ? | C,F | #1134 (open) |
| RB9 | Cross-system **identity reconciliation** — join the same human across Shopify/QB/Google on **email** (the join key). **Largely premature**: the only live facet (Shopify order-email → checkin Person/membership) is ALREADY the `PaymentException` `UNMATCHED_ORDER` engine; QB leg blocked on `GC-QB` (zero QB integration), Google leg blocked on `CM1` (no mailing list). Real net-new = an email-drift detector (person's Shopify/contact email ≠ checkin email → payments/list silently miss them) | CREATE | PARKED | L | ? | B,V5,V7 | none |
| RB11 | GAP-2 **drift-guard CI ban** (fail on new getServerSession / unregistered prisma route) — re-armable | ENHANCE | READY-FOR-DEV | S | ? | C | none |
| RB12 | `handler()` consolidation end-state (~75 withAuth routes → handler default) + response-envelope phase 2 | CHORE | READY-FOR-DEV | L | ? | C | #721 (open) |
| RB13 | §7.7 security library extraction (`@checkin/security`) | CHORE | NEEDS-DESIGN | L | ? | C | #281 (closed) |
| RB14 | Unbuilt scopable+sensitive routes pending scoping (`OPT_OUT_PENDING_ROUTE` set) | CREATE | NEEDS-DESIGN | M | ? | C | none |
| RB15 | `@sensitivity` classifications on vendored Prisma schemas (monitoring-db, s-ingest-core) — pre-commit gate will block | CHORE | READY-FOR-DEV | S | ? | F | #236 (open) |
| RB16 | Boundary-isolation job → make it a **required status check** on main (branch-protection config, not code) [CODEOWNERS gate #1132 fixed by #1135/#1136, closed] | FIX | READY-FOR-DEV | S | ? | F | #1133 (open); #1132 closed |
| RB17 | Role-assignment UI won't scale at ~10 roles; role-search results cut off | ENHANCE | READY-FOR-DEV | S | ? | F | #161, #1150 (open) |
| RB18 | Auth-app: **do NOT port** — checkin RBAC supersedes (recorded for scope clarity) | — | — | — | ? | A | none |
| RB20 | Vocab rename ledger (UNFINISHED.md): leadMentor→ProgramLeader, staff→Treehouse Volunteer, dues→membership-fee, ToolLevel explicit rank, dependent retire+BUG-2, payment "certified"→"manual", etc. | CHORE | READY-FOR-DEV | M | ? | C | none |

---

## Reverse coverage — open GH issues → backlog mapping

All 40 open issues are associated above **except** these, which are pure bugs/chores that don't merit a backlog *feature* (track as-is in GH), or are stale/close-candidates:

- **Closed by hand** (2026-07-20, audit-confirmed done): #237, #235, #160 — no longer tracked here.
- **Keep/kill decisions**: #354 (FR7), #975 (CO8).
- **Rescope**: #472 (CM11 — RSVP ripped out).
- Everything else maps to an item above (see GH column). No open issue is unaccounted-for.

## Near-term priority signals (from Q33 triage)

Owner-assigned relative priority. Not a schedule — a lean. Still high-level (discovery), no deep-dive committed.
- **A convergence candidate (not confirmed the priority):** the **receipt → catalog → inventory → QB** pipeline (GC-INVENTORY + GC-QB + expense port). Noted as a natural grouping, not an agreed center of gravity. See TOPDOWN.
- **Soon / near-top:** **M6** per-≥18-child agreement · **M1** board "who hasn't paid since Sept 1" dashboard · **SA6** delete-DOB for all adults (#1165) · **M15** enforce certifier ∈ member-family (#164, HIGH — certifier can grant tool use).
- **Short term:** **P1** program→instance restructure · **P4/#82** auto-close enrollment · **M13** settings-400 bug (#1130) · **M16** BLOCKED-recovery flow · **P14** program calendar load (Google Calendar).
- **Short–medium:** **P9** copy-program (#156) · **P13** manual-only-program flag (ops/leader manual-add bypassing Shopify cap).
- **Medium term:** **CO1** Shopify segment-pricing · **P2/P3** seat reservation + waitlist (#942) · **P10** member-visibility timing (#152) · **CO2/#278** honor-system discount / process-ID (exploiting it is an ethics violation → unlikely short-term).
- **Medium-ish, other-dev-owned** (may land in passing): comms — **CM11** event-cancel-notify (#472) · **CM8/CM9** program-email controls + batching (#1153/#1154).
- **Discuss / tee up:** **RB7** admin-role ambiguity (a decision conversation).
- **Soon, pending buy-in:** **RB8** declarative row-visibility (#1134) — owner advocating with others.
- **Needs real data first:** **AT1/AT2** attendance inference/ambiguity — assess with real data before scoping.
- **P7** Shopify↔capacity reconciliation — gap CONFIRMED (V2): comp-add path skips `adjustProgramInventory`. No longer "investigate"; it's real.
- **Lower:** **M2** state-maintenance cron (want the dashboard, not the cron) · **PL2** PII read-audit.
- **In-flight (lands ~this week):** **CM** mailing-list automation (fixes the email bug).
- **Parked:** **M9** corporate membership → Consciously not modeled.

## Parked partial PRs (post-first-release — scope sources, NOT done)

13 open `post-first-release` PRs are **done-ish but underspecified** (same disease as past PRs). **Mine for scope, do NOT treat as complete or merge-ready.** They show what someone already attempted for each item — input for the eventual issue-writing. Full detail: `sources/post_release_pr_map.md`. Several are *partial even as code*.

| INDEX item | parked PR | how complete (per PR body) |
|-----------|-----------|----------------------------|
| M4 archive family | #959 | soft-archive present |
| M5 cascade removal | #965 | grace→auto-withdraw designed+coded |
| P5 program archive | #954 | `Program.archivedAt` present |
| P6 Shopify auto-archive | #955 | **partial** — listing archive only; no empty-category warnings |
| P14 calendar load | #952 | **partial** — .ics export + Google template links, NOT a live feed |
| CM1 mailing-list sync | #960 | Google Group sync; **CONFLICTING — needs rebase** |
| PL4 time-scoped contact | #963 | ±7d window, audited |
| SA1 BG automation | #961 | **partial** — student-nudge/consent slice only |
| P1 program→instance | #953 | **phase 1 only** — additive schema + backfill, nothing reads it |

_Merge health: #960 + #1109 CONFLICTING (rebase); other 11 mergeable=UNKNOWN (GitHub hasn't recomputed — re-poll, not a clean signal)._

## Consciously not modeled (no real timeframe)

Deliberately parked — real concepts, but we do not intend to model them in any foreseeable timeframe.
Not dropped (they're valid), not backlog (no plan to build). Revisit only if priorities change.

| item | why parked | src |
|------|-----------|-----|
| **AT7** — age-based shop/tool state from who's present | No control point (system doesn't lock shop doors/tools) → tracking has no value. Distinct from two-deep (AT6, which IS in scope). | B,C · Q12 |
| **Repeat-donor CRM** — recurring-donor relationships, thank-yous, next-year asks | Heavily deferred (owner: "not in the next 2 years"). Intake/receipting IS in scope (FD1/FD3/FD6/FD7); the relationship layer is QB/Benevity's lane for now. | Q76 |
| **Machine-status comms** — "laser down this week" member notice | Too rare to build for. Heavily deferred. | Q82 |
| **Program Budgets** — budget lifecycle (draft→Board approve→carry-over/revert), incl. much of GC-FIN-CONTROL's budget layer | Very low priority; not painful. Expense/receipt→QB is the pain, not budgeting. **Partial revival (Q62): the read-only budget-vs-actual VIEW is now FE8** — the lifecycle engine stays unmodeled. | TOPDOWN GC-FIN-CONTROL |
| **Formal data-subject rights + retention/disposal engine** — Know/Correct/Delete requests, retention schedule, legal-hold | Handled manually; a subject request has never been received. Only stale-membership auto-purge (M3) stays in scope. | TOPDOWN GC-DATA-RIGHTS · Q17 |
| **Data-security ops** — 2FA/backups/unique-accounts/no-remote-access | Handled externally / already in the infra repo (AWS). Not app work. | Q18 |
| **Financial-controls enforcement** — COI/kinship engine, segregation-of-duties enforcer, threshold *blocking* | Replaced by a flag→human-checkoff→audit model (Q14); the app records/routes, humans enforce. | Q14 |
| **Scholarship cap engine** — 20%/50% caps, budget-line automation | Board decides case-by-case, each unique; fine as-is. | Q25 |
| **Facility/shop/incidentals fee build** | Fees live in Shopify, paid by a few folks; no app build needed. | Q25 |
| **Payment-plan Shopify flow** | Payment plans handled directly in QuickBooks; not building a Shopify flow. | Q25 |
| **M9 — Corporate / Org-Partner membership** | Not needed in a real timeframe (Q33). | Q33 |

## Dropped — confirmed built (not backlog)

**RB19** — pentest email-enumeration oracle: verified **already closed / not exploitable** (fix-chip made no code change, 2026-07-21). Dropped.

**Obsolete (2026-07-21):** SA2 wipe-polluted-blanket-BG-data — **no polluted data exists**; everyone was re-imported per-adult after the DB change. Removed. _(⚠ likely also moots SA1's "blanket-stamp→per-adult migration" sub-part — verify when SA1 is scoped.)_

**Verified built during triage (2026-07-21), removed from buckets:** M10 volunteer-household pre-designation (`/membership-ops/volunteer-memberships`) · M11 intake-notes → surfaced to reviewer + gates BG review (`membership-ops/review`, `Household.intakeNotes`) · SA5 BG posture (29mo, enforced at renewal) · SA8 dual-relationship = Trusted Adults · RB10 dual-email = 2-account model (#286 closed) · FD5 banker = board (no role).

From chip E (verified in code) + D2 (landed): renewal BG re-trigger + no-email-lookup (A7), reviewer-sets-volunteer (A14 core), trusted-adults dedup+revoke (A15), emergency-contact external check (A16), **RSVP subsystem** (B11), **recurring events** (B12), keyholder warn + forced-signout (C6/C8), orphaned-payment queue (D21), payment-plan keyholder-invisibility (D22), reviewer anti-collusion (F9), denied-login block (G2), system metrics (G13), duplicate-visit detection (#563), allergies-on-add-member (#800), Zoho auto-send contracts (#189), Shopify match-audit report (#1048). Full evidence in `sources/verification.md` + `sources/pr_deferred_landed_check.md`.

## Epics (span buckets)
- **E-PIPELINE** — Receipt→Catalog→Inventory→Expense (FR* + CI* + FE* + CI4). PORT, XL, needs-design. Ships bundled or not at all.
- **E-FINANCE-INDEP** — Benevity donations (FD1) + income QB-recon (FD4). The two independently shippable finance ports.
- **E-PROGRAM-INSTANCE** — P1 restructure + dependents (P7, P10, capacity). IN-DESIGN, don't-start; gated on CO1.
- **E-SEGMENT-PRICING** — CO1/CO2/CO3/CO4 + CO9. Shopify member/volunteer entitlement enforcement.
- **E-MAILING** — CM1..CM6 (Google-Group foundation + rules + cleanup). Gated on CM1.
- **E-BG-AUTOMATION** — SA1..SA4. Board-gated by SA5 decisions.
- **E-MEMBERSHIP-LIFECYCLE** — M1/M2/M3/M5 state machine + maintenance.
