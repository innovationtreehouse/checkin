# CheckMeIn Architecture Improvement Ideas

A comprehensive list of re-architecture and refactoring opportunities based on a full review of the codebase (~50 API routes, 31 pages, 20 Prisma models, 10 lib modules).

---

## 1. Centralized Auth Middleware

**Problem:** Every API route independently calls `getServerSession(authOptions)`, then manually checks `user.sysadmin`, `user.boardMember`, `user.keyholder`, etc. This pattern is copy-pasted across 40+ route handlers with slightly different permission checks, leading to inconsistencies and bugs.

**Examples of duplicated auth:**
- `api/admin/participants/route.ts` defines a local `SessionUser` interface inline
- `api/attendance/route.ts` casts to `any` and checks roles ad-hoc
- `api/scan/route.ts` has its own multi-path auth (kiosk vs. session vs. household lead)
- `api/admin/roles/route.ts`, `api/admin/households/route.ts`, etc. all repeat the same patterns

**Proposed Solution:**
Create a `withAuth()` higher-order function or middleware module in `src/lib/auth.ts`:

```ts
// Usage in route handlers:
export const GET = withAuth({ roles: ['admin'] }, async (req, user) => {
  // user is typed, validated, and guaranteed to be an admin
});

export const POST = withAuth({ roles: ['self', 'householdLead', 'admin'] }, async (req, user) => {
  // ...
});
```

This would:
- Eliminate ~200 lines of duplicated session-checking boilerplate
- Centralize role definitions (`admin` = sysadmin OR boardMember; `staff` = admin OR keyholder)
- Return properly typed users instead of `any` casts everywhere
- Make it trivial to add new roles or change permission logic in one place
- Auto-log/audit elevated actions

**Impact:** 🔴 High — directly addresses security consistency and code duplication

---

## 2. Shared TypeScript Types & Interfaces

**Problem:** Types are defined inline, ad-hoc, or via `any` casts throughout the codebase. The `Participant`, `Visit`, `SessionUser`, etc. types are re-declared differently in every page and route that uses them.

**Examples:**
- `kioskdisplay/page.tsx` defines its own `Participant`, `Visit`, `Counts`, `SafetyFlags`, `SessionUser` types (lines 9–81)
- `household/page.tsx` uses inline type annotations for household data (line 15–24)
- API routes use `session?.user as any` everywhere
- `getFullAttendance.ts` exports data without a named return type
- `admin/layout.tsx` uses `{sysadmin?: boolean; boardMember?: boolean; keyholder?: boolean}` inline

**Proposed Solution:**
Create `src/types/` directory with shared type files:
- `src/types/participant.ts` — Participant, SessionUser
- `src/types/attendance.ts` — Visit, Counts, SafetyFlags, AttendanceResponse
- `src/types/household.ts` — Household, HouseholdMember
- `src/types/api.ts` — API response envelopes, error types

**Impact:** 🟠 Medium-High — eliminates `any` casts, prevents drift between frontend and backend types

---

## 3. Extract Reusable UI Components

**Problem:** Several UI patterns are duplicated across every page with massive inline `style={{...}}` objects:

| Pattern | Repeated In |
|---------|-------------|
| Glass card container | `page.tsx`, `household/page.tsx`, `kioskdisplay/page.tsx`, all admin pages |
| Success/error message banner | `page.tsx` (L222-233), `household/page.tsx` (L280-291), `profile/page.tsx` |
| Modal overlay with backdrop | `page.tsx` (L236-271), `kioskdisplay/page.tsx`, `admin/events/[id]/page.tsx` |
| Role badge pill (e.g. "Sysadmin", "Keyholder") | `page.tsx` (L122-124), `kioskdisplay/page.tsx`, `admin/roles/page.tsx` |
| Person card with name/email/phone | `kioskdisplay/page.tsx` (L336-417), `household/page.tsx` (L329-456) |
| Form inputs with labels | `household/page.tsx` (L474-513), `admin/participants/new/page.tsx` |
| Safety warning banners (two-deep, last keyholder) | `page.tsx` (L130-141), `kioskdisplay/page.tsx` (L655-691) |

**Proposed Solution:**
Create shared components in `src/components/`:
- `AlertBanner.tsx` — success/error/warning message display
- `Modal.tsx` — standard modal overlay with backdrop + close-on-click-outside (already needed this pattern 3x)
- `RoleBadge.tsx` — small colored pills for roles
- `PersonCard.tsx` — name, email, phone card
- `FormField.tsx` — labeled glass input
- `SafetyWarning.tsx` — two-deep and last-keyholder warnings

**Impact:** 🟠 Medium — reduces page sizes by hundreds of lines, prevents styling drift

---

## 4. CSS Module System Instead of Inline Styles

**Problem:** The vast majority of styling uses inline `style={{...}}` objects — some single elements have 10+ CSS properties defined inline. `household/page.tsx` alone is 651 lines, with probably 40% being inline style objects. `kioskdisplay/page.tsx` is 958 lines with similar ratios.

**Specific issues:**
- Inline styles can't use pseudo-selectors (`:hover`, `:focus`)
- No media queries possible inline
- Style objects are re-created on every render
- Massive JSX noise makes component logic hard to follow
- Color values like `rgba(239, 68, 68, 0.2)` are magic-numbered everywhere

**Proposed Solution:**
1. Define a design token system in `globals.css` or a new `tokens.css`:
   ```css
   :root {
     --color-danger: rgba(239, 68, 68, 1);
     --color-danger-bg: rgba(239, 68, 68, 0.2);
     --color-danger-border: rgba(239, 68, 68, 0.4);
     --color-success: rgba(34, 197, 94, 1);
     --color-success-bg: rgba(34, 197, 94, 0.2);
     /* ... */
   }
   ```
2. Create CSS modules for each page (many already have `.module.css` files that are barely used)
3. Move repeated patterns into utility classes in `globals.css`

**Impact:** 🟡 Medium — huge readability improvement, enables responsive design, reduces bundle size

---

## 5. Consolidate the `isStudent` / Age Calculation Logic

**Problem:** The "is this person a student?" check (age < 18 from DOB) is implemented identically in three separate places:

1. `src/lib/getFullAttendance.ts` → `isStudentByDob()` (lines 3-11)
2. `src/app/kioskdisplay/page.tsx` → `isStudent()` (lines 65-73)
3. `src/app/household/page.tsx` → inline age check (line 371, 406)

**Proposed Solution:**
Export a single canonical `isMinor(dob)` function from `src/lib/time.ts` or a new `src/lib/participant-utils.ts` and use it everywhere.

**Impact:** 🟢 Low — quick fix, prevents age-calculation bugs across the board

---

## 6. Duplicated "Get Relevant Programs" Query

**Problem:** The query to find which programs a participant is enrolled in (as participant, volunteer, or lead) is written twice identically in `attendanceTransitions.ts`:

1. `findAssociatedEventAt()` — lines 14-33
2. `processVisitCheckout()` — lines 83-102

Both make the same 3 Prisma queries and merge the results the same way.

**Proposed Solution:**
Extract to a shared helper:
```ts
async function getRelevantProgramIds(participantId: number): Promise<number[]>
```

**Impact:** 🟢 Low — simple DRY cleanup, already in the same file

---

## 7. Refactor the Monolithic `/api/scan` Route

**Problem:** `api/scan/route.ts` is a 279-line single function that handles:
- Two different auth paths (kiosk signature + web session)
- Household permission checks
- Badge event logging
- Check-in flow (facility open check, event association, visit creation, notifications)
- Check-out flow (last keyholder logic, double-badge confirmation, force-close, visit chunking, post-event emails)
- System metric recording

This is the single most critical function in the app and it's extremely difficult to test, read, or modify safely.

**Proposed Solution:**
Break into composable service functions in `src/lib/`:
- `authenticateScanRequest(req)` → returns `{ authType, user?, error? }`
- `processCheckin(participantId, authContext)` → handles check-in logic
- `processCheckout(participantId, activeVisit, authContext)` → handles check-out + keyholder logic
- Keep the route handler as a thin orchestrator that calls these services

**Impact:** 🔴 High — the scan route is the most important endpoint and currently the hardest to maintain

---

## 8. Deduplicate the `fetchAttendance` Function on the Client

**Problem:** In `kioskdisplay/page.tsx`, the attendance-fetching logic (including kiosk signature header construction) is copy-pasted 3 times:

1. The `useEffect` initial fetch (lines 150-209)
2. Inside `handleForceCheckout()` (lines 247-268)
3. Inside `handleManualCheckIn()` (lines 293-314)

**Proposed Solution:**
Extract to a single `refreshAttendance()` callback defined once with `useCallback`, and call it from all three locations.

**Impact:** 🟢 Low — simple refactor, prevents the 3 copies from drifting apart

---

## 9. Monolithic Page Components

**Problem:** Several pages are very large single-file components with all state, effects, handlers, and rendering in one function:

| Page | Lines | Concern |
|------|-------|---------|
| `kioskdisplay/page.tsx` | 958 | Attendance display, check-in, check-out, search, modals, safety warnings |
| `household/page.tsx` | 651 | Member list, add member, edit member, settings, visit history |
| `admin/page.tsx` | ~300+ | Dashboard with multiple data sections |
| `programs/[id]/page.tsx` | Very large | Program detail, events, participants, volunteers |

**Proposed Solution:**
Decompose into sub-components:
- `kioskdisplay/` → `AttendanceColumn.tsx`, `SafetyBanner.tsx`, `ManualCheckInSearch.tsx`, `EmergencyContactModal.tsx`
- `household/` → `MemberCard.tsx`, `MemberForm.tsx`, `HouseholdSettings.tsx`, `VisitHistory.tsx`

**Impact:** 🟡 Medium — major readability and maintainability improvement

---

## 10. API Response Consistency

**Problem:** API routes return data in inconsistent shapes:
- Some return `{ success: true, participant }`, others `{ participant }`
- Error responses vary between `{ error: "..." }` and `{ message: "..." }`
- Some use HTTP status codes correctly, others return 200 with error fields
- The attendance API overloads POST to handle both `MANUAL_CHECKIN` and `TWO_DEEP_VIOLATION` — very different operations under one endpoint

**Proposed Solution:**
1. Standardize all API responses:
   ```ts
   // Success: { data: T }
   // Error: { error: string, details?: any }
   ```
2. Split `POST /api/attendance` into:
   - `POST /api/attendance/manual` (already exists but underused)
   - `POST /api/attendance/safety-notification`
3. Create a response helper:
   ```ts
   // src/lib/api-response.ts
   export const apiSuccess = (data: any) => NextResponse.json({ data });
   export const apiError = (error: string, status: number) => NextResponse.json({ error }, { status });
   ```

**Impact:** 🟡 Medium — improves client-side error handling reliability and API discoverability

---

## 11. Remove Debug Artifacts

**Problem:** Production debug artifacts remain in the codebase:
- `api/attendance/route.ts` line 75: `require('fs').writeFileSync('/home/dkay/...')` — writes to a hardcoded local path on error
- `api/scan/route.ts` has extensive `console.log()` statements throughout (`---> API /api/scan HIT`, etc.)
- Multiple `eslint-disable` directives at the top of files suppressing useful warnings

**Proposed Solution:**
1. Remove the `fs.writeFileSync` debug line (the `logBackendError` DB logger already handles this)
2. Replace `console.log` debug statements with the structured logger or remove them
3. Audit and remove unnecessary `eslint-disable` directives; fix actual type issues instead

**Impact:** 🟢 Low effort, 🔴 High importance — the `fs.writeFileSync` is a potential security issue in production

---

## 12. Create a Notification Template Engine  

**Problem:** HTML email templates are built as template-literal strings inline across multiple files:
- `notifications.ts` (lines 113-120, 146-153)
- `postEventEmails.ts` (lines 84-99)

Each has its own inline styling, structure, and branding. Adding a new email or changing the look requires touching multiple files.

**Proposed Solution:**
Create an `src/lib/email-templates/` directory with:
- A base HTML layout template (header, footer, branding)
- Individual template functions for each email type
- Shared styling constants

**Impact:** 🟡 Medium — pays off quickly as more email types are added (enrollment, reminders, etc.)

---

## 13. Kiosk Auth as First-Class Middleware

**Problem:** Kiosk signature verification is handled differently in each route that supports it:
- `api/scan/route.ts` has inline kiosk auth + fallback to dev mode
- `api/attendance/route.ts` has a different inline kiosk auth pattern
- The kiosk display page manually constructs auth headers from URL params

**Proposed Solution:**
Create a unified `authenticateRequest(req)` function that returns:
```ts
type AuthResult = 
  | { type: 'kiosk' }
  | { type: 'session', user: SessionUser }
  | { type: 'unauthenticated' }
```

This integrates with idea #1 (centralized auth middleware) and eliminates the parallel auth paths.

**Impact:** 🟠 Medium-High — critical for security consistency

---

## 14. Database Query Optimization

**Problem:** Several areas make an N+1 or redundant queries:
- `attendanceTransitions.ts` makes 3 separate queries to find participant programs (could be a single `OR` query)
- `getFullAttendance.ts` calls `activeVisits.filter()` multiple times re-iterating the full list
- The nightly cron and post-event processor each re-query similar event data
- `handleSaveSettings` in `household/page.tsx` fetches the current profile just to merge settings — the API should handle merging

**Proposed Solution:**
- Combine the 3 program queries into one:
  ```ts
  const programIds = await prisma.$queryRaw(...) // single query with UNION
  ```
- Pre-compute derived attendance lists once in `getFullAttendance`
- Add proper database indexes for hot query paths (e.g., `Visit.departed` for the active-visits query)

**Impact:** 🟡 Medium — matters more as user base grows

---

## 15. Error Boundary & Loading State Components

**Problem:** Every page independently implements its own loading state (`"Loading..."` text in a glass container) and error handling (usually just `console.error`). There's no React Error Boundary anywhere.

**Proposed Solution:**
1. Create `src/components/LoadingSpinner.tsx` — a shared animated loading component
2. Create `src/components/ErrorBoundary.tsx` — catches React rendering errors
3. Create a `src/components/PageShell.tsx` — handles the auth-check-then-redirect pattern used by every page

**Impact:** 🟡 Medium — prevents white-screen errors in production, reduces boilerplate

---

## 16. Environment & Config Management

**Problem:** Environment variables are accessed directly via `process.env.X` scattered throughout the codebase with no validation, and some have inconsistent fallbacks:
- `postEventEmails.ts` checks `VERCEL_URL` with a fallback to `localhost:4000`
- `verify-kiosk.ts` reads `KIOSK_PUBLIC_KEY` with a null fallback
- Dev mode detection is done differently in different files

**Proposed Solution:**
Create a `src/lib/config.ts` that:
- Validates all required env vars at startup
- Exports typed constants: `config.baseUrl`, `config.isDev`, `config.kioskPublicKey`
- Throws meaningful errors if critical vars are missing

**Impact:** 🟢 Low effort — prevents runtime surprises from missing/misconfigured env vars

---

## Priority Matrix

| Priority | Idea | Effort | Impact |
|----------|------|--------|--------|
| 🔴 P0 | #11 Remove debug artifacts | Low | Security |
| 🔴 P0 | #1 Centralized auth middleware | Medium | Security + DRY |
| 🔴 P0 | #7 Refactor `/api/scan` | Medium | Maintainability |
| 🟠 P1 | #13 Kiosk auth as middleware | Medium | Security |
| 🟠 P1 | #2 Shared TypeScript types | Low | Type safety |
| 🟠 P1 | #10 API response consistency | Medium | Reliability |
| 🟡 P2 | #3 Reusable UI components | Medium | DRY + UX consistency |
| 🟡 P2 | #4 CSS module system | High | Readability |
| 🟡 P2 | #9 Decompose monolithic pages | Medium | Readability |
| 🟡 P2 | #15 Error boundary + loading | Low | User experience |
| 🟢 P3 | #5 Consolidate `isStudent` | Very Low | DRY |
| 🟢 P3 | #6 Deduplicate program query | Very Low | DRY |
| 🟢 P3 | #8 Deduplicate `fetchAttendance` | Very Low | DRY |
| 🟢 P3 | #12 Email template engine | Medium | Scalability |
| 🟢 P3 | #14 Database query optimization | Medium | Performance |
| 🟢 P3 | #16 Config management | Low | Reliability |
