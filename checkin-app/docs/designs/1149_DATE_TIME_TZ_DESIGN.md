# Date / Time / Timezone — architecture & remediation design

This is the design of record for how `checkin-app` handles dates, times, and
timezones. It began as an audit of the program-date off-by-one reported in issue
#1149 and grew: the same defect recurs across the app because there is **no
canonical date/time layer** and the code **conflates instants with calendar
dates**. The program-date display bug is just one *slice* of this problem — this
design covers the whole class and stands on its own. (No owning GitHub issue yet —
the worktree name `issue-354-…` refers to an unrelated dead-schema ticket; file a
tracking issue if one is wanted.)

**Status:** design. **Date:** 2026-07-24.

### Shipping progress

- **#1366 (program dates, F2 — in review):** implements the program-date slice
  with **this design's calendar-date model**, after an initial org-tz-instant
  approach was reworked to align. It lands the two canonical helpers in
  `lib/time.ts` — `parseDateOnly(value) = value ? new Date(value) : null`
  (UTC-midnight write) and `formatDateOnly` (UTC-pinned read) — writes program
  `startAt`/`endAt` via `parseDateOnly`, reads via `formatDateOnly` at all three
  display sites, **no migration**. Closes #1149.
- **Precedent set:** the calendar-date convention is now concrete —
  **store UTC-midnight via `parseDateOnly`, read via `formatDateOnly`** (Model A).
  The remaining calendar-date fields (DOB, `memberSince`, `lastBackgroundCheck`,
  boundary) reuse these helpers rather than re-deciding. The `@db.Date` question
  ([open decision](#open-decision-calendar-date-storage-model)) stays open as a
  later schema-honesty pass; #1366 did **not** migrate.

## The defect class (recap)

- `<input type="date">` yields a date-only string, e.g. `"2026-08-15"`.
- A write of `new Date("2026-08-15")` parses that as **UTC midnight**
  (`2026-08-15T00:00:00.000Z`).
- A read of `formatDate(...)` (`lib/time.ts`) renders in
  `APP_TIMEZONE = 'America/Chicago'`. UTC-midnight rendered in Chicago is the
  **day before** → off by one for anyone west of UTC.
- Root: the write pins one timezone, the read pins a different one, and nothing in
  the type system says which fields are calendar dates vs instants — so every site
  decides for itself and they disagree.

**Two structural roots** (the [Architecture](#architecture-the-tz-root) section
designs the fix):

1. **Instant / calendar-date conflation.** `formatDate` applies a wall-clock zone
   (`America/Chicago`) to *both* true instants (visit/event times — correct) and
   calendar dates (DOB, program dates — wrong; a calendar date has no zone). The
   two need different handling and the code doesn't distinguish them.
2. **Three competing timezone sources.** Client display hardcodes `APP_TIMEZONE`
   (Chicago); `toDatetimeLocal` uses the **browser** zone; server event creation
   uses the **editable org zone** from `AppSettings` (`getAppSettings().timezone`).
   The hardcoded client zone silently disagrees with the configured org zone the
   moment a non-Central region deploys — the TODO already flagged atop `time.ts`.

Every semantic calendar-date field in `schema.prisma` is a `DateTime` (a
timestamped instant), never `@db.Date` — the schema doesn't encode the
instant/date distinction, so it can't enforce it. See Finding 12 and
[the storage decision](#open-decision-calendar-date-storage-model).

---

## Ranked findings

### 1. DOB stored at three different wall-clock conventions across write paths — BUG

**Category:** 2 (new Date on date-only) + 3 (client/server tz divergence)
**Severity:** bug (user-visible off-by-one; also feeds age gates — see #7)

`Person.dateOfBirth` (`schema.prisma:84`, `DateTime?`) is written by its routes
with **two incompatible conventions** for the same field (a third,
`+"T00:00:00.000Z"`, appears for `OrgMembership.memberSince` at
[households/[id]/route.ts:59](checkin-app/src/app/api/membership-ops/households/[id]/route.ts)
— functionally identical to bare midnight, listed here for completeness):

| Convention | Where | Result |
|---|---|---|
| **UTC midnight** `new Date(dob)` | **shared choke-point** [`normalizeAdultDob` — adultDob.ts:28](checkin-app/src/lib/person/adultDob.ts) (#1165; its docstring mandates *every interactive DOB write* route through it), reached by [profile/route.ts:56](checkin-app/src/app/api/profile/route.ts), [household/route.ts:110](checkin-app/src/app/api/household/route.ts), [membership-ops/participants/route.ts:85,96](checkin-app/src/app/api/membership-ops/participants/route.ts). **Bypassing it:** [intake.ts:221](checkin-app/src/lib/membership/intake.ts) (`toDate`, the signup/children/parents path — a second interactive path *not* funneled through the guard) and [importDob.ts:22](checkin-app/src/lib/importDob.ts) (bulk import; docstring says the cron/backfill is its net, not the write guard) | `2026-08-15T00:00:00Z` → displays as **Aug 14** in Chicago |
| **UTC noon** `new Date(dob+"T12:00:00Z")` | [household/member/route.ts:59](checkin-app/src/app/api/household/member/route.ts) (edit member) — note it passes the **noon** string *into* `normalizeAdultDob`, so the midnight/noon split now lives at the call sites feeding the shared helper | `2026-08-15T12:00:00Z` → displays as **Aug 15** everywhere west of UTC+12 — the only display-safe writer |

**Concrete scenario:** a guardian's DOB entered at membership signup (midnight
UTC) shows as one day earlier than intended on any `formatDate`/`toLocaleDateString`
screen. If that same guardian later edits the member via the household-member
edit form (noon UTC), the *stored value shifts forward by a calendar day* and
the display "corrects itself." Same person, same field, two different stored
dates depending on which UI last touched it.

**Direction:** pick ONE convention for `dateOfBirth` and use it at every writer.
Cheapest: standardize on noon-UTC (the existing safe outlier) so display is
tz-robust without touching every reader; OR standardize on midnight-UTC and read
with `formatDateOnly` everywhere. Do not leave both.

### 2. Program `startAt`/`endAt` off-by-one — BUG (CONFIRMED; reported as #1149)

**Category:** 1 · **Severity:** bug

Write: [programs/route.ts:217](checkin-app/src/app/api/programs/route.ts) /
[programs/[id]/route.ts:37,179](checkin-app/src/app/api/programs/[id]/route.ts)
— `new Date(startAt)` on a date-only string → UTC midnight.
Display: [programs/page.tsx:130](checkin-app/src/app/programs/page.tsx),
[programs/[id]/page.tsx:427](checkin-app/src/app/programs/[id]/page.tsx),
[my-activities/programs/page.tsx:109](checkin-app/src/app/my-activities/programs/page.tsx)
— `formatDate` (Chicago) → **day before**.

The originally-reported case. The edit-form input read
[program-ops/programs/[id]/page.tsx:104](checkin-app/src/app/program-ops/programs/[id]/page.tsx)
uses `.split('T')[0]` (UTC slice), so the *input* round-trips; only the
`formatDate` *display* is wrong. **Resolved in #1366** (in review) with this
design's model: `parseDateOnly` write + `formatDateOnly` at the three display
sites, no migration.

### 3. `OrgMembership.memberSince` displayed in local tz, written in UTC — BUG

**Category:** 3 · **Severity:** bug

Write: [membership-ops/households/[id]/route.ts:59](checkin-app/src/app/api/membership-ops/households/[id]/route.ts)
— `new Date(\`${body.memberSince}T00:00:00.000Z\`)` (explicit UTC midnight).
Display: [membership-ops/households/page.tsx:28](checkin-app/src/app/membership-ops/households/page.tsx)
and [households/[id]/page.tsx:30](checkin-app/src/app/membership-ops/households/[id]/page.tsx)
— `new Date(s).toLocaleDateString("en-US", {...})` with **no `timeZone`** → renders
in the viewer/server local zone → **day before** west of UTC.

Note the write-side round-trip guard at
[households/[id]/route.ts:70](checkin-app/src/app/api/membership-ops/households/[id]/route.ts)
(`toISOString().slice(0,10)`) is UTC and *correct*, so the stored value is
stable; only the two list/detail displays are off.

**Direction:** these displays are the mirror of the write's UTC pin — add
`timeZone: "UTC"` to the two `toLocaleDateString` calls, or route them through
`formatDateOnly`.

### 4. DOB shown via `formatDate` (Chicago) — BUG

**Category:** 1 · **Severity:** bug

[membership-audit/broken/page.tsx:89](checkin-app/src/app/membership-audit/broken/page.tsx)
— `formatDate(m.dateOfBirth)`. DOB is stored UTC-midnight (Finding 1), so Chicago
rendering shows the day before. Direct consumer of the Finding-1 root cause.
**Direction:** `formatDateOnly`.

### 5. DOB shown via bare `toLocaleDateString()` — BUG

**Category:** 5 · **Severity:** bug

[membership-ops/participants/merge/page.tsx:48](checkin-app/src/app/membership-ops/participants/merge/page.tsx)
— `d.toLocaleDateString()` with no `timeZone`, used to render DOB (and any date
value) in the merge diff. UTC-midnight DOB → local render → off by one.
**Direction:** `formatDateOnly` for the DOB rows.

### 6. `lastBackgroundCheck` shown via bare `toLocaleDateString()` — BUG

**Category:** 2/5 · **Severity:** bug (compliance-facing)

Write: [membership-ops/participants/[id]/route.ts:40](checkin-app/src/app/api/membership-ops/participants/[id]/route.ts)
— `new Date(raw)` on a `YYYY-MM-DD` string → UTC midnight
(`schema.prisma:93`, `DateTime?`).
Display: [membership-audit/compliance/page.tsx:178](checkin-app/src/app/membership-audit/compliance/page.tsx)
— `new Date(h.lastBackgroundCheck).toLocaleDateString()` → local → day before.
A background-check date reading one day early is a compliance-report artifact.
**Direction:** `formatDateOnly`; align the writer's convention with #1.

### 7. `calculateAge` / `isYouth` read local fields off a UTC-midnight DOB — LATENT (safety-adjacent)

**Category:** 4 · **Severity:** latent (server-tz dependent; flips only on the birthday)

[time.ts:98](checkin-app/src/lib/time.ts) reads `getFullYear/getMonth/getDate`
(local) from a DOB stored at UTC midnight. On a server **not** in UTC
(e.g. Chicago), `new Date("2008-07-24T00:00:00Z")` is `2008-07-23 19:00` local →
`getDate()` returns **23**. On the person's actual birthday the computed age is
one day out, which can flip:

- program age gate [programAge.ts:37](checkin-app/src/lib/programAge.ts)
  (`calculateAge(person.dateOfBirth, program.asOf)` → `age < minAge` / `age > maxAge`)
- youth badge [getFullAttendance.ts:73](checkin-app/src/lib/getFullAttendance.ts)
  (`isYouth(v.person.dateOfBirth)`)
- **DOB-write guard** [adultDob.ts:29](checkin-app/src/lib/person/adultDob.ts)
  (`normalizeAdultDob`: `calculateAge(d) > MAX_PROGRAM_AGE` decides whether to
  **strip the DOB** and set `isDeclaredAdult`) — the same local-field read decides
  a *persisted* mutation, so on the 26th-birthday boundary it can wrongly keep or
  drop a DOB. Highest-stakes `calculateAge` caller.

**Scenario:** a program with `minAge: 18` evaluated on the applicant's 18th
birthday can reject them on a Chicago-hosted server because age computes as 17
for the UTC-midnight birth instant. Assessed, **not fixed** per task. Compounds
with Finding 1 (noon-UTC DOBs are immune; midnight-UTC DOBs are exposed) — a
person's gate result can depend on which UI last saved their DOB.
**Direction:** compute age from the UTC fields of the DOB
(`getUTCFullYear/Month/Date`) to match how the date-only value was stored, and
standardize DOB storage (Finding 1) so the two never disagree.

### 8. Visit-filter window mixes UTC parse with local `getDate`/`setDate` — LATENT

**Category:** 5 · **Severity:** latent (±1 day on a 15-day window; low blast radius)

[profile/visits/route.ts:21-25](checkin-app/src/app/api/profile/visits/route.ts)
and [household/visits/route.ts:21-25](checkin-app/src/app/api/household/visits/route.ts)
— `const baseDate = new Date(filterDateStr)` (UTC midnight) then
`startDate.setDate(baseDate.getDate() - 7)` (`getDate`/`setDate` are **local**).
On a non-UTC server the local day-of-month read off a UTC-midnight instant can be
the previous day, shifting the ±7-day window by one. Cosmetic on a wide window,
but the parse/read tz mismatch is the same defect.
**Direction:** compute the window with UTC arithmetic, or from the date-only
string directly.

### 9. Attendance filter window label off by one — COSMETIC

**Category:** 1/5 · **Severity:** cosmetic

[attendance/household/page.tsx:50](checkin-app/src/app/attendance/household/page.tsx)
— `formatDate(new Date(filterDate).getTime() ± 7d)`. `new Date(filterDate)` is
UTC midnight, `formatDate` is Chicago → the two window-boundary *labels* read one
day early. Display-only label; the actual query is server-side (Finding 8).
Default value at line 43 uses `new Date().toISOString().split('T')[0]` (today in
UTC) which can already be "tomorrow" late in the Chicago evening.

### 10. Facility trends bucketing uses local calendar fields — LATENT

**Category:** 5/6 · **Severity:** latent (aggregate; boundary visits only)

[facility/trends/route.ts:15-48](checkin-app/src/app/api/facility/trends/route.ts)
— `getPeriodStart` uses `getDay/getMonth/setDate/setHours(0,0,0,0)` (all local),
and `formatPeriodLabel` uses `toLocaleDateString` with **no `timeZone`** even
though it fetches `locale` from `getAppSettings`. Week/month/quarter boundaries
are computed in server-local tz, so a visit near local midnight can fall into an
adjacent bucket, and labels don't honor the org tz. Aggregate hours, so a
misbucketed edge visit is low-impact, but it bypasses the org-tz contract the
rest of the server honors.
**Direction:** bucket and label against the org timezone from `getAppSettings`.

### 11. `parseImportDob` yields UTC-midnight DOBs — LATENT

**Category:** 2 · **Severity:** latent (feeds Finding 1's display bug)

[importDob.ts:12-24](checkin-app/src/lib/importDob.ts) — both branches
(`new Date(dobString)` for a string, `Date.UTC(1899,11,30)+serial*86400000` for
an Excel serial) produce **UTC-midnight** instants. Internally consistent
(preview and commit agree, which is the file's stated goal), but it feeds the
same midnight-UTC DOBs that display one day early (Findings 4-5) and can trip the
age gate (Finding 7). Bulk import means many rows at once.
**Direction:** fold into the Finding-1 convention decision.

### 12. Semantic calendar-dates modeled as `DateTime`, not `@db.Date` — LATENT (structural root)

**Category:** 7 · **Severity:** latent (root enabler of the whole class)

Every field that is *semantically a calendar date* is stored as a timestamp:
`Person.dateOfBirth` (`schema.prisma:84`), `Person.lastBackgroundCheck` (`:93`),
`Program.startAt`/`endAt` (`:842`/`:844`), `OrgMembership.memberSince` (`:409`),
`BoardSettings.orgMembershipYearBoundary` (`:528`). A `DateTime` has no canonical
wall-clock, so each writer/reader must independently agree on a tz — and they
don't (Findings 1-6). A `@db.Date` column stores a pure calendar date with no
time/zone, which would make the entire off-by-one class structurally impossible.

**Direction:** this is the schema half of the [Architecture](#architecture-the-tz-root).
Whether these columns become `@db.Date` (schema-enforced calendar dates) or stay
`DateTime`-by-convention is the [OPEN storage decision](#open-decision-calendar-date-storage-model)
— left to the group, evaluated on its own merits (no pre-rejection from a
display-only lens). Note `@db.Date` alone never fixes display (Prisma still reads
UTC-midnight) — the read layer is designed separately.

---

## Confirmed correct (the map)

These handle tz properly — documented here so the report doubles as a reference.

- **`lib/programYear.ts`** (`nextBoundary`, `landsNextYear`) — all-UTC
  (`Date.UTC`, `getUTC*`). Membership-year boundary math is tz-consistent. ✓
  Mirrored correctly in [orgMembership.ts:101](checkin-app/src/lib/orgMembership.ts).
- **Settings → membership boundary** — write
  [settings/membership/route.ts:57](checkin-app/src/app/api/settings/membership/route.ts)
  (UTC midnight) + display [settings/membership/page.tsx:34](checkin-app/src/app/settings/membership/page.tsx)
  (`toLocaleDateString(..., timeZone: "UTC")`) + input read `page.tsx:79`
  (`.slice(0,10)`, UTC). Write and read pin the **same** zone → round-trips. ✓
  This is the pattern the buggy sites should copy.
- **Boundary echoes** — [settings/outreach/route.ts:34](checkin-app/src/app/api/settings/outreach/route.ts)
  and [membership/renewal-status/route.ts:33](checkin-app/src/app/api/membership/renewal-status/route.ts)
  — `nextBoundary(...).toISOString().slice(0,10)`, UTC in and out. ✓
- **Event creation** — [events/route.ts:46-97](checkin-app/src/app/api/events/route.ts)
  — explicitly converts wall-clock times against the **org timezone** via
  `fromZonedTime(startLocal, timezone)` from `getAppSettings`. The intended,
  correct pattern for datetimes. ✓ (Minor fragility: `parseISO` of a date-only
  string is local-midnight; consistent here because the time is overwritten
  before zoning, but it's the one seam to watch if the server tz ever drifts.)
- **Cron day-boundary jobs** — [scholarship-grace-expiry/route.ts:33](checkin-app/src/app/api/cron/scholarship-grace-expiry/route.ts)
  (`now - graceDays*DAY_MS`, `lte cutoff`) and the sweeps
  (`person-bg-annual`, `trusted-adult-expiry`, `membership-renewals` all pass
  `new Date()`) do **instant** arithmetic, which is tz-agnostic. ✓
- **`toDatetimeLocal` / `fromDatetimeLocal`** ([time.ts:71-87](checkin-app/src/lib/time.ts))
  — deliberately browser-tz (documented), correct for `datetime-local` inputs. ✓
- **`household/member` DOB (noon UTC)** ([household/member/route.ts:54](checkin-app/src/app/api/household/member/route.ts))
  — display-safe, but **inconsistent** with its sibling writers (Finding 1). It's
  "correct" only by being the one that dodges the trap.

---

## Architecture (the tz root)

The 12 findings are symptoms of two missing distinctions. The design makes both
explicit and routes every temporal value through one layer so the class can't be
reintroduced.

### Axis 1 — classify every temporal field (instant vs calendar date)

This is the spine. Every date/time field is exactly one kind, and the kind
dictates storage + read + age handling:

| Kind | Meaning | Store | Render | Examples |
|---|---|---|---|---|
| **Instant** | a moment on the timeline | `DateTime` (timestamptz, UTC) | in the **resolved org display tz** | `Visit.arrivedAt/departedAt`, `Event.startAt/endAt`, all audit `*At`, `expires`, `pendingSince`, `paidAt`, `announcedAt` |
| **Calendar date** | a day, no time, no zone | `date` **or** `DateTime`-at-UTC-midnight (the [open decision](#open-decision-calendar-date-storage-model)) | **UTC-pinned** (zone-independent); age via `getUTC*` | `dateOfBirth`, `lastBackgroundCheck`, `Program.startAt/endAt`, `OrgMembership.memberSince`, `orgMembershipYearBoundary` |
| **Wall-clock time-of-day** | "15:00" entered for an event | composed with a date into an **instant** via `fromZonedTime(org tz)` | via the instant it produces | event start/end *time* (events/route.ts — already correct) |

Today `formatDate` applies a wall-clock zone (`America/Chicago`) to **both**
instants (right) and calendar dates (wrong). The whole off-by-one class is that
one conflation. Splitting the two kinds is the fix; the storage question below is
*how strongly* to enforce the split.

### Axis 2 — one display timezone source

Three zones are in play today and they disagree:

- **Hardcoded** `APP_TIMEZONE = 'America/Chicago'` — every client `formatDate/Time/DateTime`.
- **Browser zone** — `toDatetimeLocal` (deliberate, for native `datetime-local` inputs).
- **Editable org zone** — `AppSettings.timezone`, used **server-side only**
  (events/route.ts via `getAppSettings()`), the source of truth the TODO atop
  `time.ts` already names.

**Design:** all **instant** formatters resolve their zone from
`AppSettings.timezone`, plumbed to the client (a layout/context provider, or a
server-component prop). `APP_TIMEZONE` stays only as the AppSettings seed default
and offline fallback. This is the second-region-readiness the `time.ts` note flags;
until it lands, a non-Central deploy silently renders instants in the wrong zone.

- `toDatetimeLocal`/`fromDatetimeLocal` stay browser-zone (native input contract)
  — document as the one deliberate exception. Known edge: an admin editing an
  event from a different zone enters browser-local, which then converts through
  the org zone on save. Acceptable single-region; revisit when the provider exists.
  *(ponytail: don't org-tz-pin the input until a second region actually deploys.)*

### The canonical layer (`lib/time.ts` as the sole authority)

No route or component parses/formats a temporal field by hand. One primitive per
kind, so a stray `new Date(str)` / `toLocaleDateString` / `.getFullYear()` on a
temporal value is a reviewable smell:

- **Calendar read:** `formatDateOnly(date)` — a new helper in `lib/time.ts`,
  UTC-pinned: `toLocaleDateString(undefined, { timeZone: 'UTC', ...opts })`. The
  app-wide calendar-date formatter (the counterpart to `formatDate`, which stays
  for instants).
- **Calendar write:** `parseDateOnly(str)` — turns an `<input type="date">` string
  into the chosen calendar-date storage rep, replacing the ad-hoc
  `new Date(str)` / `+"T12:00:00Z"` / `+"T00:00:00.000Z"` conventions (Finding 1).
- **Age:** `calculateAge`/`isYouth` on `getUTC*` (calendar-date semantics) — F7.
- **Instant read:** `formatDateTime/formatTime/formatVisitRange`, zone sourced
  from the resolved org tz (Axis 2), not the hardcoded constant.
- **Instant input round-trip:** `toDatetimeLocal/fromDatetimeLocal` (browser-zone,
  documented exception).

## Open decision: calendar-date storage model

Axis 1 says these five fields are calendar dates. **How strongly the schema
enforces that is the group's call** — evaluated on its own merits. One tempting
shortcut to dismiss up front: *"`@db.Date` isn't worth it — Prisma still reads
UTC-midnight, so you need `formatDateOnly` anyway, and the migration adds nothing."*
That holds only in a display-only lens; once we're (re)designing the schema and
sweeping the readers regardless, `@db.Date`'s value (schema-enforced classification,
write-collapse, dedup honesty) is a separate question — weighed below, not
pre-rejected.

**Model A — `DateTime` by convention.** Keep the columns; enforce the calendar-date
contract in the helper layer: `parseDateOnly` on every write (one convention),
`formatDateOnly` on every read, `getUTC*` age.
- **Pros:** zero migration, zero live-data risk; the backbone helpers already do
  all the user-visible work.
- **Cons:** schema doesn't self-document — nothing stops a future `new Date(str)`
  + `formatDate` from reintroducing the bug (mitigated only by review/lint); the
  DB stores a fake `00:00:00Z`; exact-match dedup needs the writers *actually*
  consistent (or a range query — see below).

**Model B — `@db.Date`.** Migrate the calendar-date columns to Postgres `date`.
- **Pros:** the schema **enforces** the classification — a `date` can't carry a
  time or render zoned; all write conventions collapse at the DB (Finding 1 gone
  by construction); the `USING (col::date)` type-change **self-backfills**
  existing rows; exact-match dedup works honestly; pairs exactly with
  `formatDateOnly` (Prisma reads `date` back as UTC-midnight).
- **Cons:** a live migration per column (6 columns); **reads are still
  UTC-midnight, so `formatDateOnly` is still required** — B *adds to* the read
  layer, never replaces it; the read-value shift is **tsc-blind** (TS type stays
  `Date`) so integration tests are the guard; one-way in practice (can't recover a
  time-of-day, though none was meaningful).

**Hybrid is allowed** — e.g. `@db.Date` only where it buys a *functional* win,
`DateTime`-by-convention elsewhere. It weakens the "schema self-documents" benefit
(some dates are `date`, some aren't) but concentrates migration effort. The
per-field decision inputs:

| Field | Does `@db.Date` add a *functional* win beyond consistency? |
|---|---|
| `Person.dateOfBirth` | **Yes — strongest case.** Multiple disagreeing writers (F1) **and** an exact-match consumer: import dedup `where: { dateOfBirth: parsedDob }` (import/preview/route.ts:256, import/route.ts:242) silently misses a noon-stored DOB vs a midnight `parsedDob` → duplicate Person. |
| `Program.startAt` / `endAt` | **Shipped Model A in #1366** — `parseDateOnly` write + `formatDateOnly` read, no migration; `@db.Date` would be consistency-only. `{ endAt: { gte: new Date() } }` (programs/route.ts:86) behaves identically. Event `startAt/endAt` are a *different* model — stay `DateTime`. |
| `OrgMembership.memberSince` | Consistency-only. Single writer; roundtrip guard (households/[id]/route.ts:70) already UTC-safe. |
| `Person.lastBackgroundCheck` | Consistency-only. Single writer; `bgValidUntilBoundary` (renewal.ts:75-83) already truncates to a UTC day (a no-op under `@db.Date`). |
| `BoardSettings.orgMembershipYearBoundary` | Consistency-only. All consumers already UTC (`nextBoundary` `getUTC*`, display `timeZone:'UTC'`). |

> **DECISION OWED (group):** Model A, Model B, or hybrid — and if hybrid, which
> columns. The trade is **schema honesty / bug-un-reintroducibility** (B) vs
> **minimal migration on live data** (A). This design does **not** pre-pick; the
> minimize-migration and schema-honesty weights are both legitimate. Whatever is
> chosen, the read/write/age/tz-source layer (Sequencing steps 1-6) is the same.

**`@db.Date` mechanics, if Model B or hybrid is chosen:** migration is
`ALTER COLUMN … TYPE date USING (col::date)` — a direct date-part cast that
preserves each row's calendar day, self-backfilling. **Do NOT write
`USING (col AT TIME ZONE 'UTC')::date`:** these columns are `timestamp(3)` *without*
time zone (Prisma's default `DateTime`; no `@db.Timestamptz` in the schema), so
`AT TIME ZONE 'UTC'` reinterprets the naive value as a `timestamptz` instant and
the `::date` then casts it in the **connection's** `TimeZone` — on any session west
of UTC that silently decrements every row by a day. Plain `col::date` on a
timestamp-without-tz takes the date part with no zone involved. Rolling-deploy
drain is safe:
old code reads the `date` column as the UTC-midnight `Date` it already handled, so
reads stay backward-compatible. Do it **per column** (start with `boundary` or
program dates as the low-risk proof), grep test fixtures for hardcoded
`…T00:00:00.000Z` strings, and run the membership-ops / household / import
integration suites — `tsc` green is necessary, not sufficient.

## Sequencing

**Layer + symptoms — do regardless of the storage decision. Fixes everything a
user sees and makes the class un-reintroducible:**

1. **Establish the canonical layer** in `lib/time.ts`: `formatDateOnly` +
   `parseDateOnly` **land in #1366** — reuse them, don't re-add. Still to do here:
   move age to `getUTC*`, and source the instant formatters from the resolved org tz.
2. **Sweep calendar-date readers → `formatDateOnly`:** F2 (the three program
   display sites) **done in #1366**; remaining: F4/F5 (DOB), F6 (BG), F3
   (memberSince displays + the `getFullYear` read at my-household:378), F9 (filter
   label).
3. **Route calendar-date writes through `parseDateOnly`** (one convention).
   Interactive DOB already funnels through **`normalizeAdultDob` (adultDob.ts:28)**
   — apply `parseDateOnly` **there** and the four delegating routes (profile,
   household, household/member, participants) are fixed at once; also strip the
   `+"T12:00:00Z"` from the household/member call site so all callers pass a bare
   date string. Then the two paths that bypass the guard: `intake.ts:221` (`toDate`
   — route it through `normalizeAdultDob` or at least `parseDateOnly`) and
   `importDob.ts` (bulk). Other calendar-date writers: memberSince
   (households/[id]:59), program dates, boundary.
4. **Age → `getUTC*`:** F7 — time.ts:98 (`calculateAge`) itself, exercised via
   programAge:37, getFullAttendance:73, my-household:41/406, attendance/current:85,
   roles:54, **and `normalizeAdultDob` (adultDob.ts:29)** — the last decides a
   *persisted* DOB strip, so it's the highest-stakes caller.
5. **Wire org display tz to the client instant formatters** (Axis 2) — the
   AppSettings provider; `APP_TIMEZONE` becomes fallback only. Second-region
   readiness.
6. **Fix server date-window tz-mixing:** F8 (profile/visits, household/visits) and
   F10 (facility/trends) — `Visit`/aggregate **instants**, compute in UTC or the
   org tz. Not calendar-date candidates.

**Gated on the storage decision:**

7. Apply the chosen storage model. **Model A:** step 3 makes new rows consistent;
   also close the DOB dedup gap for *existing* mixed rows with a same-UTC-day
   **range query** at import/preview:256 + import:242. **Model B / hybrid:**
   migrate the chosen columns to `@db.Date` (self-backfilling, per mechanics
   above); `parseDateOnly` for those becomes "hand off the calendar date, DB
   truncates," and the dedup gap closes by construction.

---

*Date/time/timezone design of record. No product code, schema, or migrations were
changed. The program-date display fix (reported as issue #1149) is one slice
absorbed into this design.*
