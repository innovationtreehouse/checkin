# Public listing for members-only programs

#1711

## Problem

`orgMemberOnly` on Program conflates two concerns: catalog visibility and
enrollment eligibility. When true, non-members cannot see the program at all —
the catalog hides it and the detail page returns 404 (anonymous) or 403
(signed-in non-member).

Some programs should be visible to everyone for awareness — what it is, when it
runs, what it costs — while still requiring Treehouse membership to enroll. Today
the only options are fully public (anyone can enroll) or fully hidden (members
only even know it exists).

## Objective

A program leader can mark a members-only program as publicly listed. Non-members
see it in the catalog and on its detail page but cannot enroll without becoming a
member first.

## Design

### Schema

One new column on `Program`:

```prisma
model Program {
  // ...existing fields...
  orgMemberOnly   Boolean  @default(false)
  publicListing   Boolean  @default(false)
}
```

`publicListing` is meaningful only when `orgMemberOnly` is true. When
`orgMemberOnly` is false the program is already public and enrollable by anyone —
`publicListing` is ignored. No constraint enforces this; the queries just don't
read it when the program is already open to everyone.

### The three states

| `orgMemberOnly` | `publicListing` | Catalog | Detail page | Enrollment |
|---|---|---|---|---|
| `false` | (ignored) | Everyone sees it | Everyone reaches it | Anyone signed in |
| `true` | `false` | Members only | 404 anon / 403 non-member | Members only |
| `true` | `true` | **Everyone sees it** | **Everyone reaches it** | Members only |

### Catalog API (`GET /api/programs`)

Current filter for non-members (line 92-93 of `route.ts`):

```ts
andClauses.push({ orgMemberOnly: false });
```

Becomes:

```ts
andClauses.push({
  OR: [
    { orgMemberOnly: false },
    { publicListing: true },
  ],
});
```

Members-only programs with `publicListing: false` remain hidden from
non-members. The anonymous-cacheable path widens to include publicly listed
programs, which is correct — the listing reveals no membership-sensitive data.

### Detail API (`GET /api/programs/[id]`)

Current gate (line 157-161 of `[id]/route.ts`):

```ts
if (program.orgMemberOnly && !isPrivileged) {
    if (!sessionUser) throw notFound('Program not found');
    const duesSettled = await isDuesSettled(sessionUser.id);
    if (!duesSettled) throw forbidden('Forbidden: Member-Only Program');
}
```

Becomes:

```ts
if (program.orgMemberOnly && !isPrivileged && !program.publicListing) {
    if (!sessionUser) throw notFound('Program not found');
    const duesSettled = await isDuesSettled(sessionUser.id);
    if (!duesSettled) throw forbidden('Forbidden: Member-Only Program');
}
```

A publicly listed program lets everyone through to the detail view. Enrollment
is still gated at the enrollment route — `orgMemberOnly` + `isDuesSettled` check
in `POST /api/programs/[id]/participants` is unchanged.

### Detail page UI (`programs/[id]/page.tsx`)

For a non-member viewing a publicly listed members-only program:

- Program details (dates, age range, capacity, pricing) render normally.
- The "Eligibility: Treehouse Members only" badge stays visible (line 465).
- The non-member price is shown where configured. If the program is members-only
  with no non-member price, only the member price appears — this is information,
  not a payment action.
- The enroll button is replaced with a message: "Become a Treehouse Member to
  enroll" linking to the membership application page.
- For anonymous users: "Sign in to enroll" (existing behavior) — after sign-in,
  they land back on this page and see the membership message if they're not a
  member.

The detail API already returns `orgMemberOnly` on the program object. The page
needs to know whether the viewer is a member to decide which button to show. The
route already fetches the session; non-member status is derivable from the
absence of an active/dues-settled org membership in the household data the
enrollment flow already fetches.

No new API field needed — the page checks `program.orgMemberOnly` (already
present) and the viewer's membership status (already fetched during enrollment
init) to decide between the enroll button and the membership prompt.

### Enrollment API (no change)

`POST /api/programs/[id]/participants` already checks:

```ts
if (currentProgram.orgMemberOnly && !(await isDuesSettled(participantId))) {
    return apiError("...", 403);
}
```

This gate is unchanged. A non-member who somehow reaches the enrollment endpoint
for a publicly listed members-only program is still rejected.

### Admin form

The "new program" form (`program-ops/new/page.tsx`) and "edit program" form
(`program-ops/programs/[id]/page.tsx`) gain a sub-toggle:

When "Members Only" is checked, a secondary checkbox appears:
**"Show in public catalog"** — unchecked by default (preserving current behavior
for existing programs).

When "Members Only" is unchecked, the sub-toggle hides (irrelevant).

### Pricing display

A publicly listed members-only program may carry both member and non-member
prices (set before `orgMemberOnly` was toggled, or set deliberately for the
public listing). The detail page already shows both when present and hides the
non-member price when the program is members-only (line 261 of
`programs.md` rules: "hides the non-member price where the program is members
only").

For a publicly listed program this rule should relax: show both prices when both
are set, since non-members can now see the page. If only the member price is set,
show it. The non-member price field on the admin form should unlock when
`publicListing` is checked, even though `orgMemberOnly` is true — a publicly
visible program may want to show what non-member pricing would be, or the
organization may decide to handle non-member enrollment at a different price
outside the app.

> **Open question:** Should a publicly listed members-only program allow
> non-member enrollment at the non-member price? This would make `publicListing`
> more than a visibility toggle — it would become "visible and enrollable by
> everyone, at different price tiers." The issue text says "not joinable without
> being a member," so the design keeps enrollment gated. But if pricing for both
> tiers is set, there's a natural path to opening enrollment to non-members at the
> higher price. Raising for owner decision.

### Announcements

Program announcements (`announceOnOpen`) email families whose membership covers
the program. Publicly listed programs do not change this — the announcement
targets members, not the general public. The public catalog is the discovery
channel for non-members.

### Rules-doc amendments — requires board ruling

Two entries in `docs/rules/programs.md` are affected. Both carry tiers that
cannot be amended in a PR alone (per `docs/DOCUMENTATION_STANDARD.md` §3.2).

**1. Catalog filtering (line 234-238)** — tier: **[Decision — *Policy: Records
Policy, Art. IV*]**

> "The catalogue filters rather than gates: an anonymous caller reaches it and
> sees less, and is never told that a members-only program exists."

This is a Policy-tier rule. The proposed amendment — "unless the program is
publicly listed" — relaxes a Records Policy guarantee. **Board action required**
before this rule can change. The implementation PR must not land until the board
has ruled on whether publicly listing a members-only program is consistent with
the Records Policy, or has amended Art. IV to allow it.

**2. Detail-page silence (lines 240-242)** — tier: **[Decision — *Principle: no
existence oracle*]**

> "A members-only program's own page keeps that silence. An anonymous caller is
> told there is no such program; a signed-in caller who is not a member is told it
> exists and that it is members only."

This is Principle-tier. The proposed change — a publicly listed program lets
everyone reach its detail page — is a deliberate, scoped exception to the
no-existence-oracle principle: the program leader has explicitly opted into
public visibility. **Owner escalation required** to confirm this exception is
acceptable.

Proposed amended text (pending both rulings):

> The catalogue filters rather than gates: an anonymous caller reaches it and
> sees less, and is never told that a members-only program exists unless the
> program's leader has marked it as publicly listed. A publicly listed
> members-only program appears in the public catalogue and its detail page is
> reachable by anyone; enrollment remains gated on membership. A members-only
> program that is not publicly listed keeps the existing silence — an anonymous
> caller is told there is no such program; a signed-in caller who is not a member
> is told it exists and that it is members only.

### Anonymous catalog cache

The public catalog response is cached for 60 seconds (`stale-while-revalidate`).
When an admin toggles `publicListing`, the program may take up to 60 seconds to
appear in (or disappear from) the anonymous catalog. This is acceptable — the
same lag already applies when `orgMemberOnly` or `phase` is changed.

## Migration

```sql
ALTER TABLE "Program" ADD COLUMN "publicListing" BOOLEAN NOT NULL DEFAULT false;
```

No data transform. All existing programs default to `false`, preserving current
behavior.

## Files touched

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `publicListing` field |
| `prisma/migrations/*/` | Migration file |
| `src/app/api/programs/route.ts` | Catalog filter: OR with `publicListing` |
| `src/app/api/programs/[id]/route.ts` | Detail gate: skip when `publicListing` |
| `src/app/programs/[id]/page.tsx` | Non-member enrollment message |
| `src/app/program-ops/new/page.tsx` | Sub-toggle on admin form |
| `src/app/program-ops/programs/[id]/page.tsx` | Sub-toggle on admin form |
| `docs/rules/programs.md` | Two rule amendments |
| `src/app/api/programs/[id]/eligible-participants/route.ts` | Unaffected (gates on `orgMemberOnly`, not visibility) — confirm in sweep |
| `PUBLIC_PROGRAM_SELECT` in `api/programs/route.ts` | Add `publicListing` to select; `@sensitivity` annotation is additive (no boundary-isolation concern) |
| Tests for the above routes | Assert the three-state matrix |

## What's not built

- Non-member enrollment at a non-member price for publicly listed programs
  (raised as open question above).
- Public listing for PLANNING-phase programs (they remain hidden from
  non-admin/non-board regardless of `publicListing`).
- Separate "publicly listed" program count or analytics.
