# Data-fetching pattern audit + migration plan

Investigation-only report. 41 `page.tsx` files under `src/app` hand-roll `useState`+`useEffect`+`fetch` for data loading, each with subtly different loading/error/race-condition handling. This doc records the audit findings and a phased migration plan to a shared pattern.

> **Update (2026-07-02, post-rebase on main):** a parallel effort landed on main (#702, #703, #704) and already fixed the string-sniffing / hardcoded-tone AlertBanner bugs called out below on `facility-ops/visits`, `facility-ops/badges`, `profile`, `shop-ops/create`, `membership-ops/review`, `membership`, and `safety/trusted-adults` — converging each onto a typed `{ text, tone }` AlertBanner state instead of message-string sniffing. The findings below are left as originally audited (pre-fix) for the historical record; **Phase 1's `facility-ops/visits` string-sniff fix and Phase 4-adjacent `membership-ops/review` AlertBanner convergence are no longer needed** — treat those two files as already fixed when scoping Phase 1/7 work. Remaining string-sniff/tone bugs (`attendance/current/page.tsx:410`, `program-ops/programs/[id]/page.tsx:223`, `program-ops/sessions/[id]/page.tsx:398`) were not touched by this fix and still apply.

## Scope verification

Query: `grep -rl 'useEffect' src/app --include="page.tsx" | xargs grep -l 'useState' | xargs grep -l 'fetch('`

Result: 41 files, matching prior audit list exactly — no drift.

## Real variance found

| Pattern | Files (sample) |
|---|---|
| Single fetch | `membership-ops/review`, `program-ops/programs/[id]`, `program-ops/sessions/[id]`, `facility-ops/visits`, `settings/roles` |
| Independent parallel (not `Promise.all`) | `page.tsx:43-97` (attendance status + membership check, separate effects) |
| Query-param/filter-driven refetch | `facility-ops/trends/page.tsx:48-62` (deps `[period, programId, ready]`) |
| Debounced search | `membership-ops/participants/page.tsx:60-78`, `attendance/current/page.tsx:152-175` |
| Polling (auto-retry) | `attendance/current/page.tsx:133` — `setInterval` 60s, only instance of built-in refresh |
| 4 fetch-effects + postMessage write path in one file | `attendance/current/page.tsx` — most complex file in the set |
| `Promise.all` | only `facility-ops/print-badges` |

Refetch-on-mutation: 3 different styles — explicit refetch call (`review/page.tsx:69`), optimistic-update-then-rollback-only-on-fail (`settings/roles/page.tsx:64,80,84`), local `.map()` patch with no refetch at all (`membership-ops/participants/page.tsx:130,157`).

### Race conditions (confirmed, no guard)
`facility-ops/trends:48-62`, `membership-ops/participants:60-78`, `attendance/current:102-150` (poll vs postMessage handler), `attendance/current:152-175`.

Zero of 41 files use `AbortController`. Only 2 of 41 (`page.tsx`, `membership/page.tsx`) use even a manual `cancelled` flag, and inconsistently within the same file.

### Error surfacing — 4 competing mechanisms, no convention
1. `AlertBanner` component (15/41 files) — but tone often hardcoded wrong: `program-ops/programs/[id]/page.tsx:223` and `sessions/[id]/page.tsx:398` hardcode `tone="info"` even for real errors.
2. Raw Mantine `<Alert>` inline (`my-activities/programs`, `page.tsx`)
3. `notifications.show()` toast (`membership-ops/participants`)
4. Native `alert()` (`attendance/current/page.tsx:205,208,228,232`)

### String-sniffing (confirmed bug class)
- `facility-ops/visits/page.tsx:151` — `tone={message.includes('success') ? 'success' : 'error'}`
- `attendance/current/page.tsx:410` — `error === "Unauthorized" ? ... : error`

### Silent-swallow bugs (blank state, no error shown)
- `membership-audit/broken/page.tsx:16-26` — catch only `console.error`s, no error state exists in component at all.
- `membership-audit/unclaimed/page.tsx` — same pattern.
- `attendance/current/page.tsx:95-97` — household section just doesn't render on failure.
- `facility-ops/trends/page.tsx:44,60` — failed fetch indistinguishable from "no data."

## Existing hooks (`src/hooks`) — none fit

- `useRequireRole` — role gate, not data fetch.
- `useTodoCounts` / `useConflicts` — module-singleton fetch+cache hooks, but deliberately swallow errors ("best-effort, failed fetch leaves last value"), no AbortController. Good pattern for background badges, wrong template for primary page data.
- `useAutoCycle` — UI carousel, irrelevant.

No generic `useFetch`/`useApiData` exists.

## package.json check

No react-query/SWR/tanstack installed, none used anywhere in `src`.

## Recommendation: adopt SWR, don't hand-roll

Every bug found above (race conditions on stale response, no abort, inconsistent error state, silent swallow, no request dedup) is what SWR/react-query solve by default — dedup, cache, `mutate()` for refetch, revalidate-on-focus, built-in error object. A hand-rolled `useFetch` would just reinvent SWR badly and still need someone to remember AbortController every time.

SWR over react-query: smaller (~4kb), simpler API, fits fetch-only use case here — no complex mutation/optimistic-update framework needed beyond what SWR's `mutate` gives.

No new hook needed beyond a shared fetcher, e.g.:

```ts
const { data, error, isLoading, mutate } = useSWR<ProgramDetail>(
  ready ? `/api/programs/${id}` : null,   // null key = skip fetch (handles useRequireRole gating)
  fetcher
);
```

- Query-param-driven (trends): key becomes `` `/api/trends?period=${period}&programId=${programId}` `` — SWR auto-refetches on key change, auto-cancels stale response by design (race conditions gone free).
- Debounced search: pair SWR with existing debounce (keep the `setTimeout`, feed debounced value into key) — SWR's dedup handles the rest.
- Refetch-on-mutation: `mutate()` after POST, replaces all 3 divergent patterns with 1.
- Error: `error` is a real object always present — kills string-sniffing and silent-swallow bugs structurally (`AlertBanner tone={error ? 'error' : 'success'}`).
- Polling (attendance/current): `refreshInterval: 60000` option, replaces manual `setInterval`.

One thin shared wrapper worth writing: `src/lib/fetcher.ts` — single `fetcher(url)` throwing on non-2xx with parsed body attached (SWR convention), used by all call sites. Not a hook, one function.

## Migration difficulty (sampled files)

| File | Difficulty | Why |
|---|---|---|
| `membership-ops/review/page.tsx` | Trivial | single fetch, existing manual refetch maps 1:1 to `mutate()` |
| `facility-ops/visits/page.tsx` | Trivial | single fetch + refetch-on-save, also fixes string-sniff bug as side effect |
| `settings/roles/page.tsx` | Trivial-easy | optimistic update pattern — SWR supports optimistic `mutate(data, {optimisticData})` directly |
| `program-ops/programs/[id]/page.tsx` | Easy | single main fetch; child tabs' own fetching out of scope, checked separately (see below) |
| `facility-ops/trends/page.tsx` | Easy | param-driven key swap, deletes the race condition for free |
| `membership-ops/participants/page.tsx` | Easy-medium | debounce logic stays, wrap fetch in SWR keyed off debounced query |
| `program-ops/sessions/[id]/page.tsx` | Medium | 4 duplicated mutation handlers — migrate main fetch to SWR easily, but the 4-handler boilerplate needs its own small mutation helper, not just an SWR swap |
| `my-activities/programs/page.tsx` | Trivial | clean single fetch already, mostly a rename |
| `attendance/current/page.tsx` | Needs rework, not a swap | 4 fetch-effects + postMessage state writes + polling + kiosk auth headers in fetch call — SWR helps (poll interval, dedup) but the postMessage/fetch race and 3-mechanism error UI need actual redesign, not mechanical migration |
| `membership-audit/broken/page.tsx`, `membership-audit/unclaimed/page.tsx` | Trivial swap but fix bug during migration | currently silently swallow errors — a purely mechanical SWR swap that preserves current behavior would keep the bug; error state must be surfaced during migration, not carried over |

## Follow-up check: child tab components

`ProgramRosterTab.tsx` and `ProgramEventsTab.tsx` (children of `program-ops/programs/[id]/page.tsx:345-357`) checked for hidden auto-load fetch logic:

- `ProgramEventsTab.tsx` — 54 lines, zero `useState`/`useEffect`/`fetch` — pure display, all data via props.
- `ProgramRosterTab.tsx` — 233 lines, no `useEffect` at all. All `fetch(` calls (search eligible participants, add/remove/patch volunteer, add/remove participant) are action-triggered by user interaction, not page-load. Calls parent's `fetchProgram` prop (line 18) to refresh after mutating.

**Conclusion: no scope addition.** Neither child is a hidden 42nd/43rd hand-rolled data-load page. Phase 7 file count stays at the original 39 (minus the ones covered in earlier phases). RosterTab's action-fetches would ride along if `programs/[id]/page.tsx` gets a shared fetcher/mutation helper, not a new phase.

## Migration plan — phases

**Phase 0: Foundation**
Add SWR dep, write `src/lib/fetcher.ts` (single fetcher throwing on non-2xx). No page changes. Unblocks all else.

**Phase 1: Trivial swaps** — 🐛 fixes tone-hardcoded-info, no-cancel-on-mutation
Files: `membership-ops/review`, `facility-ops/visits` 🐛 (kills string-sniff bug), `my-activities/programs`, `settings/roles`.
Single fetch, existing manual refetch → `mutate()`, low risk, each its own PR-sized chunk.

**Phase 2: Query/filter-driven fetches** — 🐛 fixes race conditions
Files: `facility-ops/trends` 🐛 (kills stale-response race), `program-ops/programs/[id]`.
Key-based refetch replaces manual dep-array useEffect; race conditions disappear structurally.

**Phase 3: Debounced search fetches** — 🐛 fixes race conditions
Files: `membership-ops/participants` 🐛 (stale response overwrite), `attendance/current` search portion only 🐛.
Keep debounce timer, feed debounced value into SWR key. Do not touch attendance/current's other 3 effects here — scope narrowly.

**Phase 4: Silent-swallow error fixes** — 🐛 pure bug fix, blocks mechanical carry-over
Files: `membership-audit/broken`, `membership-audit/unclaimed`.
Must surface real error state during swap — flag explicitly so it's not "migrated" while keeping blank-state-on-failure bug.

**Phase 5: Multi-handler boilerplate rework**
File: `program-ops/sessions/[id]`.
Needs small shared mutation helper (not just SWR swap) to collapse 4 duplicated try/fetch/setMessage/refetch/catch blocks. Scope as its own design decision, not bulk sweep.

**Phase 6: attendance/current redesign** — 🐛 fixes race condition (poll vs postMessage)
Kiosk page — 4 fetch-effects + postMessage write path + polling + 3 error-UI mechanisms. Not a mechanical migration: needs its own mini-design (single source of truth for state writes, one error-surfacing path). Treat as separate scoped task, own review.

**Phase 7: Remaining ~30 files, bulk sweep**
Everything not yet touched from the 39/41-file list, batched by domain (membership-ops, program-ops, facility-ops, safety, etc.), each domain its own PR. Standard SWR pattern from Phase 0-3 template applies directly. Re-grep each file for silent-swallow/string-sniff before treating as trivial — don't assume "looks simple" means "no bug" (per `membership-audit/broken` precedent).

Order rationale: 0 unblocks all, 1 proves the pattern cheaply, 2-4 each fix a distinct bug class while migrating (compounds value), 5-6 isolated because they need actual redesign not swap, 7 mops up once pattern's proven.
