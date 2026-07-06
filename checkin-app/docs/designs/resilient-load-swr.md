# Resilient, status-aware page loads on SWR

Design doc. **Read-only** — no app code is changed by this document. The code
snippets below are illustrative targets, not applied edits.

> **Status & provenance (read first if you're picking this up later).**
> - **Written:** July 6, 2026. **Status:** design only — *not implemented*.
> - **Anchored to commit** `9a734d62` (branch `claude/focused-mclean-d93afc`).
>   All file paths, line numbers, `useRequireRole` role lists, server
>   `withAuth` roles, and the loader inventory in §6 were verified against that
>   commit and **will drift**. Before acting on any specific `file.tsx:NN`
>   reference, **re-grep to confirm it still exists** — treat the line numbers as
>   hints, not addresses.
> - **`swr` is NOT installed** as of this commit (`package.json` has no `swr`
>   dep) and no `SWRConfig`/`useSWR` exists anywhere in `src`. Foundation step
>   0a adds it. If a later reader finds SWR already present, some of this may
>   already be underway — check `src/hooks/useLoad.ts` and
>   `src/lib/loadFetcher.ts` first.
> - The code blocks are **illustrative and untested** — API surfaces (SWR's
>   `onErrorRetry` signature, Mantine props, Next `useRouter`) are as of the
>   versions in `package.json` at this commit; re-check against the installed
>   versions when implementing.
> - The point-in-time surveys (the idempotency investigation, the gate
>   analysis, the §6 inventory) are each stamped "as of July 6, 2026" — re-run
>   them if the codebase has moved.

## What this is

The app has ~20 hand-rolled page/section loaders. Each does `fetch` in a
`useEffect`, flips a `setLoading` flag, `catch`es into a bespoke error string,
and renders a per-page error message. None retry. None distinguish a 5xx blip
(worth retrying) from a 403 (never retry) from a 404 (never retry). A dropped
Wi-Fi packet on the emergency-contacts page shows a permanent red
"Failed to load. Ensure you have the proper authorizations." — which is both
wrong (it was a network blip, not a permission problem) and dead-ended (no way
to recover but a full reload).

This replaces all of them with **one** loader hook, `useLoad`, built on **SWR**
(the engine is already decided and not re-litigated here). `useLoad` is *loads
only*: GET-on-mount page/section data. Action errors (POST/PATCH/DELETE) keep
their existing toast/`AlertBanner` pattern and are out of scope.

Status-aware behavior, the whole point:

| Server says | Behavior |
|---|---|
| network drop / timeout / **5xx** | spinner + **bounded exponential backoff auto-retry**; recover silently when the server returns; after K attempts → terminal inline **"Couldn't load — retry"** with a manual retry button |
| **401** (not authenticated) | **no retry** → **redirect to sign-in** (`/`), matching `useRequireRole` |
| **403** (authenticated, not allowed) | **no retry** → inline **access gate** |
| **404 / 400** (not found / bad params) | **no retry** → inline terminal "not found" / "bad request" |

Scope: this is the narrow *resilience* layer — the retry/backoff/gate state
machine and the shared UI for it — not a broad rewrite of every fetch pattern
in the app. See [Migration sequence](#7-migration-sequence).

---

## Decisions (resolved)

Settled with the product owner. These are the design's fixed points.

1. **Revalidation:** `revalidateOnFocus: false` globally (the app has never
   auto-refetched on tab focus; leaving SWR's default on would silently re-hit
   sensitive endpoints). `revalidateOnReconnect: true` — kept on because it *is*
   the "recover silently when the server returns" path for the transient case.
2. **Retry:** `K = 4` (5 total attempts). Backoff **starts at 2s**, ×2 each
   attempt (~2s, 4s, 8s, 16s ± jitter), cap 30s, then the terminal card.
3. **Dependent / sequential loaders** (`merge`, `attendance/current`,
   `SystemVersionBox`): each fetch is its own `useSWR` with a **conditional key**
   (`key = dep ? url(dep) : null` — SWR skips a `null` key). Heavy client
   transforms stay in `useMemo`, unchanged.
4. **Auth (fetcher requirements):** every loader is a same-origin `fetch`, so
   the NextAuth session cookie is sent automatically (`credentials:'same-origin'`
   default) — the shared fetcher needs **nothing** for session auth. The only
   exception is the two kiosk pages (`attendance/current`,
   `attendance/certifications`), which add `x-kiosk-signature/-timestamp/-nonce`
   headers so a logged-out kiosk device can authenticate. Those use an **array
   key** `[url, { headers }]`; the fetcher forwards the `init`. GitHub calls in
   `SystemVersionBox` are external (no cookie). Everything else: plain string key.
5. **RSC / Suspense:** every loader in scope is a `"use client"` component; no
   RSC data-fetching feeds them, and the lone `<Suspense>` in `attendance/current`
   only wraps `useSearchParams`. **Do not** enable SWR `suspense: true`; keep the
   loading-flag return shape.
6. **No-retry-on-5xx exceptions** (per-hook `shouldRetryOnError:false`):
   - **GitHub public API** (`SystemVersionBox`) — unauthenticated rate limit
     ~60 req/hr; retry storms burn it.
   - **`merge` scoring** — 3 sequential fetches per attempt; retrying multiplies
     cost. Decided: no retry.
   - **Idempotency is *not* a reason to skip retry anywhere else** — see the
     investigation below: no GET handler in the API does a non-idempotent write,
     so retrying any migrated loader is correctness-safe.
7. **400 vs 404 copy:** one `TerminalState` component, parameterized so 404 says
   "not found" and 400 says "bad request" — don't label a malformed request
   "not found."
8. **`retrying` flag:** tracked explicitly via an attempt counter in the hook
   (not derived from `isValidating`), so the spinner doesn't flicker to
   "terminal" during the backoff gap between attempts.
9. **Kiosk/polling pages** (`attendance/current`, `attendance/certifications`):
   adopt the shared spinner/terminal/gate UI + `refreshInterval`, but their
   multi-fetch/postMessage redesign is a separate scoped task, sequenced last.
10. **`dedupingInterval: 5000`** (up from SWR's 2000) — several pages share keys
    (`/api/roles`, `/api/household`), so a user bouncing between them reuses one
    response.
11. **Global vs per-hook line.** *Global* (`<SWRConfig>`): fetcher, K + backoff,
    the status-aware `onErrorRetry`, `revalidateOnFocus:false`,
    `revalidateOnReconnect:true`, `dedupingInterval`. *Per-hook*: `refreshInterval`
    (pollers), `shouldRetryOnError:false` (GitHub/merge), conditional `key`
    (gated/dependent).
12. **Gate & 401 semantics.** `classify()` splits the two auth statuses:
    - **401 → `unauthenticated`:** no retry, **redirect to `/`** (sign-in) — a
      401 means the session is gone, and the only correct remedy is
      re-authenticate; a dead-end card would be wrong. `useLoad` does the
      redirect in a `useEffect`, exactly the precedent `useRequireRole` already
      sets, so navigation stays out of the fetcher.
    - **403 → `forbidden`:** authenticated but not allowed → inline `AccessGate`
      card (redirecting a logged-in user is pointless).
    - `useRequireRole` stays as the **coarse pre-fetch redirect gate**; the
      inline `AccessGate` is **defense-in-depth** for the cases where the two
      gates disagree — see the gate analysis below.

### Idempotency investigation (backs Decision #6) — as of July 6, 2026

Brace-matched every `GET` handler body in `src/app/api/**/route.ts` (both
`export async function GET` and `export const GET = withAuth(...)` styles) and
scanned for Prisma writes (`create/update/delete/upsert/…`, `$transaction`).

**Result: exactly one GET handler writes, and it is idempotent.**
`admin/settings/localization/route.ts` does
`prisma.appSettings.upsert({ where:{id:1}, create:DEFAULTS, update:{} })` — a
lazy-init of the settings singleton, no-op on an existing row, safe to retry any
number of times. It is not even one of the migrated loaders. Earlier
`attendance/route.ts` / `programs/route.ts` "hits" were false positives — the
writes live in their `POST`/`DELETE` handlers, not `GET`.

Conclusion: **retrying GET loads is correctness-safe across the whole app.**

### Gate analysis (backs Decision #12) — when does the inline gate actually fire? (as of July 6, 2026)

Roles below (`useRequireRole` args, `withAuth` role lists) are as of July 6,
2026 — re-verify if gates have been re-scoped since.

Server (`withAuth`, [lib/auth.ts:114](../../src/lib/auth.ts)):
**401** = no valid session; **403** = authenticated but wrong role / kiosk not
allowed. Client (`useRequireRole`, [useRequireRole.ts:50](../../src/hooks/useRequireRole.ts))
redirects unauthenticated and unauthorized users to `/` *before* the fetch fires
(the page `skip`s until `ready`).

When the two gates **agree**, the server never sees an unauthorized request and
the inline gate never shows. Checked the gates against each other: they mostly
match. Example that first looked like a "no client gate" hole —
`membership-audit/emergency-contacts` — is actually gated by its **layout**
(`membership-audit/layout.tsx` → `useRequireRole(["isSysadmin","isBoardMember"])`),
and the server route `/api/membership-audit/households-missing-contact` uses the
**identical** roles. They agree; inline 403 there is effectively unreachable.

So the inline **role**-gate is defense-in-depth. It genuinely fires only when a
client gate is **broader than** the server rule:

- **Any-auth client gate, finer server rule.** `program-ops/programs/[id]` gates
  with `useRequireRole([])` (any authenticated user), but `/api/programs/[id]`
  applies a **per-resource** rule (household admission), so a logged-in user
  outside the household gets a real server 403.
- **Truly public pages.** `programs/[id]/register` has no gate; a server 403 is
  the only signal (this is the coordinate-deferred page).
- **401 session-expiry mid-session** on *any* page — the *common* inline trigger,
  and the reason Decision #12 puts real weight on the 401 path (redirect), with
  the 403 card as the rarer defense-in-depth branch.

---

## Still open / awaiting decision

1. **Aside — is `SystemVersionBox` querying GitHub live at all the right design?**
   (Raised in review.) The admin panel hits GitHub's public API on mount to
   compute version drift ("commits behind main"), unauthenticated and
   rate-limited. Whether that should be a live client call vs. a cached/server
   value is a **pre-existing** question, out of scope for this migration. For now
   it migrates as-is with `shouldRetryOnError:false`. Flagged so it isn't lost.
   A follow-up task was spun off for this on July 6, 2026 — check whether
   `SystemVersionBox` still queries GitHub live before re-raising it.

---

## 1. Hook API

```ts
// src/hooks/useLoad.ts
import useSWR, { type SWRConfiguration } from 'swr';
import { useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadError, classify, type LoadErrorKind } from '@/lib/loadFetcher';

export interface UseLoadResult<T> {
  data: T | undefined;
  loading: boolean;     // first load, nothing to show yet
  retrying: boolean;    // transient failure, auto-retry in flight/scheduled
  error: { kind: LoadErrorKind } | null;  // TERMINAL only (never set mid-retry)
  retry: () => void;    // manual retry for the terminal transient card
}

export type LoadKey = string | [string, RequestInit] | null;

export function useLoad<T>(
  key: LoadKey,                 // null => skip (gated pages, dependent fetches)
  opts?: SWRConfiguration & { skip?: boolean; redirectOnUnauthenticated?: string },
): UseLoadResult<T> {
  const router = useRouter();
  const effectiveKey = opts?.skip ? null : key;
  const attempting = useRef(false);   // true while a backoff retry is scheduled (Decision #8)

  const { data, error, isLoading, mutate } = useSWR<T, LoadError>(
    effectiveKey, { ...opts },        // fetcher + onErrorRetry from global <SWRConfig>
  );

  const kind = error ? classify(error.status) : null;
  const isTerminal = !!error && (kind !== 'transient' || !attempting.current);

  // 401 => redirect to sign-in (Decision #12). Done in an effect, mirroring
  // useRequireRole, so navigation never happens inside the fetcher.
  useEffect(() => {
    if (kind === 'unauthenticated')
      router.push(opts?.redirectOnUnauthenticated ?? '/');
  }, [kind, router, opts?.redirectOnUnauthenticated]);

  return {
    data,
    loading: isLoading && !error,
    retrying: kind === 'transient' && attempting.current,
    error: isTerminal ? { kind: kind! } : null,
    retry: () => { void mutate(); },
  };
}
```

`attempting.current` is set true when the global `onErrorRetry` schedules a
retry and false when it gives up at the cap, so `retrying` stays stable across
the backoff gap (Decision #8). Wiring: `onErrorRetry` reaches the per-key flag
via a small module `Map`, or the hook merges its own `onErrorRetry` with the
global default.

### How a page consumes it

```tsx
const { ready, loading: authLoading } = useRequireRole(['isSysadmin', 'isBoardMember', 'isKeyholder']);
const { data, loading, retrying, error, retry } =
  useLoad<{ households: Household[] }>('/api/safety/emergency-contacts', { skip: !ready });

if (authLoading || loading || retrying)
  return <PageLoader label={retrying ? 'Reconnecting…' : undefined} />;
if (!ready) return null;                                     // useRequireRole redirect in flight
if (error?.kind === 'unauthenticated') return null;         // useLoad redirect to /  in flight
if (error?.kind === 'forbidden')       return <AccessGate />;// server said 403 (rare — see gate analysis)
if (error?.kind === 'notfound')        return <TerminalState variant="notfound" />;
if (error)                             return <TerminalState variant="transient" onRetry={retry} />;

const households = data!.households;
// …render
```

`unauthenticated` and `!ready` both render `null` while a redirect is in flight.
The `skip: !ready` replaces the `useEffect(() => { if (ready) fetch() }, [ready])`
gate — a `null` key means SWR doesn't fetch until `ready` flips true.

---

## 2. Fetcher + status classification

SWR's `onErrorRetry` only receives the thrown error, so the fetcher **must
throw an error carrying the HTTP status**. A plain `throw new Error()` (what
several loaders do today) loses the status and makes retry-vs-stop impossible.

```ts
// src/lib/loadFetcher.ts
export class LoadError extends Error {
  constructor(public status: number, public body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'LoadError';
  }
}

// Array key => [url, init] so kiosk-signature headers ride along (Decision #4);
// string => cookie-only (the common case).
export async function loadFetcher<T>(key: string | [string, RequestInit]): Promise<T> {
  const [url, init] = Array.isArray(key) ? key : [key, undefined];
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new LoadError(0, null, 'Network error');   // status 0 = network/timeout => transient
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new LoadError(res.status, body, (body as { error?: string })?.error);
  }
  return res.json();
}

export type LoadErrorKind = 'transient' | 'unauthenticated' | 'forbidden' | 'notfound';
export function classify(status: number): LoadErrorKind {
  if (status === 401) return 'unauthenticated';   // => redirect to sign-in (Decision #12)
  if (status === 403) return 'forbidden';         // => inline AccessGate
  if (status === 404 || status === 400) return 'notfound';   // 400 gets distinct copy
  return 'transient';   // 0 (network), 408, 429, 5xx, anything else => retry
}
```

### Retry-only-on-transient + backoff (global `onErrorRetry`)

```ts
onErrorRetry(error, _key, config, revalidate, { retryCount }) {
  // 401/403/404/400 => classify() !== 'transient' => stop immediately, no retry
  if (!(error instanceof LoadError) || classify(error.status) !== 'transient') return;
  // give up after K => the hook's `attempting` flips false => terminal card
  if (retryCount >= (config.errorRetryCount ?? 4)) return;    // K = 4 (Decision #2)

  const base = config.errorRetryInterval ?? 2000;            // start at 2s (Decision #2)
  const delay = Math.min(base * 2 ** retryCount, 30_000) * (0.5 + Math.random()); // exp + jitter, 30s cap
  setTimeout(() => revalidate({ retryCount }), delay);
}
```

`shouldRetryOnError` must stay **true** globally or `onErrorRetry` never runs;
the per-status stop lives *inside* `onErrorRetry`. Per-hook
`shouldRetryOnError:false` (GitHub, merge) short-circuits even the transient
retry (Decision #6).

---

## 3. Shared UI states

Reuse what exists; add only the two missing pieces (401 needs no UI — it
redirects).

| State | Component | Status today |
|---|---|---|
| spinner | `PageLoader` (`@/components/ui/PageLoader`) | **exists, reuse** — `Center` + `Loader` + optional `label` |
| terminal transient ("Couldn't load — retry") | `TerminalState variant="transient"` | **new** |
| terminal not-found (404) / bad-request (400) | `TerminalState variant="notfound"` (mirror the "Not Found" card already in `program-ops/sessions/[id]`) | **new** |
| access gate (403) | `AccessGate` | **new** — no inline gate exists today (`useRequireRole` only redirects) |
| unauthenticated (401) | — | no UI; `useLoad` redirects to `/` |

The two new components live in one small file next to `PageLoader`:

```tsx
// src/components/ui/LoadStates.tsx  (illustrative)
import { Button, Card, Center, Stack, Text, Title } from '@mantine/core';

export function TerminalState(
  { variant, kind, onRetry }:
  { variant: 'transient' | 'notfound'; kind?: 'notfound' | 'badrequest'; onRetry?: () => void },
) {
  if (variant === 'notfound') {
    const notFound = kind !== 'badrequest';   // Decision #7 — 400 gets its own copy
    return <Center mih="60vh"><Card withBorder p="xl" ta="center">
      <Title order={3}>{notFound ? 'Not found' : 'Bad request'}</Title>
      <Text c="dimmed" mt="xs">
        {notFound ? 'This couldn’t be loaded.' : 'The request was invalid.'}
      </Text>
    </Card></Center>;
  }
  return <Center mih="60vh"><Stack align="center" gap="sm">
    <Text c="dimmed">Couldn’t load.</Text>
    <Button variant="light" onClick={onRetry}>Retry</Button>
  </Stack></Center>;
}

export function AccessGate({ message }: { message?: string }) {
  return <Center mih="60vh"><Card withBorder p="xl" ta="center" maw={420}>
    <Title order={3}>Not authorized</Title>
    <Text c="dimmed" mt="xs">{message ?? 'You don’t have access to this page.'}</Text>
  </Card></Center>;
}
```

Existing red `<Center><Title c="red">{error}</Title></Center>` blocks
(safety/*, membership-audit/*) collapse into these. Admin panels' inline
`<Text c="red">Failed to load X.</Text>` (which have **no** retry today) adopt
`TerminalState variant="transient"` and gain a retry button for free.

---

## 4. SWR config

`src/app/layout.tsx` is a server component, but everything under it
(`MantineProvider`, `AuthProvider`) is already client. Fewest-files option:
fold `<SWRConfig>` into the existing client `AuthProvider` (it already wraps
every data-loading subtree). A standalone `<SwrProvider>` is fine too if
preferred — order relative to `SessionProvider` doesn't matter.

```tsx
// src/components/AuthProvider.tsx  (illustrative — add SWRConfig around children)
'use client';
import { SessionProvider } from 'next-auth/react';
import { SWRConfig } from 'swr';
import { loadFetcher, onErrorRetry } from '@/lib/loadFetcher';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SWRConfig value={{
        fetcher: loadFetcher,
        onErrorRetry,
        errorRetryCount: 4,          // K (Decision #2)
        errorRetryInterval: 2000,    // backoff base = 2s (Decision #2)
        revalidateOnFocus: false,    // NON-OBVIOUS: app never auto-refetched on focus (Decision #1)
        revalidateOnReconnect: true, // delivers "recover silently when server returns" (Decision #1)
        dedupingInterval: 5000,      // shared keys: /api/roles, /api/household (Decision #10)
        // shouldRetryOnError stays default true; per-status stop is inside onErrorRetry
      }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}
```

**Non-obvious-for-this-app defaults, flagged for review:**
- `revalidateOnFocus: false` — SWR defaults **true**; leaving it on would refetch
  sensitive endpoints on every tab-focus, behavior the app has never had.
- `revalidateOnReconnect: true` — kept on precisely because it's the transient
  recovery path, not just a nicety.
- `dedupingInterval: 5000` — up from 2000 because multiple pages share endpoints.

---

## 5. Migration pattern — worked before/after

### 5a. Simple transient — `app/my-activities/programs/page.tsx`

**Before** (single clean fetch, promise-chain, generic error, no retry):

```tsx
const [enrollments, setEnrollments] = useState<UserProgram[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  if (status !== 'authenticated') return;
  fetch('/api/programs/mine')
    .then(res => { if (!res.ok) throw new Error(); return res.json(); })
    .then(setEnrollments)
    .catch(() => setError('Failed to load your programs.'))
    .finally(() => setLoading(false));
}, [status]);

if (status === 'loading') return <PageLoader />;
// …later, `error` renders a raw <Alert color="red">
```

**After:**

```tsx
const { data: enrollments, loading, retrying, error, retry } =
  useLoad<UserProgram[]>('/api/programs/mine', { skip: status !== 'authenticated' });

if (status === 'loading' || loading || retrying) return <PageLoader />;
if (error) return <TerminalState variant="transient" onRetry={retry} />;
// enrollments is typed, defined here
```

Net: a network blip now spins-and-recovers instead of a permanent red alert;
the terminal state gets a retry button; the `useState`/`useEffect`/`catch`
triple is gone.

### 5b. 403 → gate — `app/safety/emergency-contacts/page.tsx`

**Before** — `useRequireRole` gate, then a fetch whose `!res.ok` collapses a 403
*and* a 5xx *and* a network drop into one misleading string:

```tsx
const { ready, loading: authLoading } = useRequireRole(['isSysadmin','isBoardMember','isKeyholder']);
const [households, setHouseholds] = useState<Household[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState('');

const fetchContacts = useCallback(async () => {
  try {
    const res = await fetch('/api/safety/emergency-contacts');
    if (res.ok) { setHouseholds(sort((await res.json()).households)); }
    else { setError('Failed to load emergency contacts. Ensure you have the proper authorizations.'); }
  } catch { setError('Network error loading contacts.'); }
  finally { setLoading(false); }
}, []);
useEffect(() => { if (ready) fetchContacts(); }, [ready, fetchContacts]);

if (authLoading || loading) return <PageLoader />;
if (!ready) return null;
if (error) return <Center mih="60vh"><Title order={3} c="red">{error}</Title></Center>;
```

**After** — `useRequireRole` stays as the redirect gate; a server 403 routes to
the inline `AccessGate`, a 401 redirects to sign-in, a 5xx / network drop
retries:

```tsx
const { ready, loading: authLoading } = useRequireRole(['isSysadmin','isBoardMember','isKeyholder']);
const { data, loading, retrying, error, retry } =
  useLoad<{ households: Household[] }>('/api/safety/emergency-contacts', { skip: !ready });

if (authLoading || loading || retrying) return <PageLoader label={retrying ? 'Reconnecting…' : undefined} />;
if (!ready) return null;
if (error?.kind === 'unauthenticated') return null;
if (error?.kind === 'forbidden') return <AccessGate />;
if (error) return <TerminalState variant="transient" onRetry={retry} />;

const households = useMemo(() => sort(data!.households), [data]);   // transform stays
```

### Interop during rollout

**Yes, migrated and unmigrated pages coexist cleanly.** `<SWRConfig>` is additive
React context; it changes behavior *only* for components that call
`useSWR`/`useLoad`. An unmigrated page's `useState`/`useEffect`/`fetch` is
untouched — including the `revalidateOnFocus:false` default, which only affects
SWR hooks. So the migration is fully incremental, page by page, with no
big-bang cutover and no shared global mutable state to coordinate.

---

## 6. Full loader inventory — as of July 6, 2026

Confirmed by reading each file at commit `9a734d62`. "Status handling today" =
does the current code branch on HTTP status, or collapse everything into
`res.ok`? **Line numbers and fetch counts drift** — re-grep each file before
migrating it; the class (transient / gate / 404 / admin-panel) is the durable
part, the `:NN` is not.

### Transient (spinner + backoff retry → terminal)

| File:line | Fetches | Status handling today | Notes for migration |
|---|---|---|---|
| [`app/attendance/current/page.tsx:126`](../../src/app/attendance/current/page.tsx) | **3** (household, attendance, roles-search) | `res.ok` only | **Redesign, not a swap.** 60s poll + `postMessage` writes + kiosk sig headers + heavy derived lists. Array-key for headers, `refreshInterval:60000`, `mutate(key,data,{revalidate:false})` for postMessage. Sequence last (§7 Batch 7). |
| [`app/attendance/certifications/page.tsx:79`](../../src/app/attendance/certifications/page.tsx) | 1 (recurring) | `res.ok` only | 10s poll (`refreshInterval:10000`) + kiosk sig headers (array key). Sort/dedupe stays in `useMemo`. Batch 7. |
| [`app/settings/roles/page.tsx:48`](../../src/app/settings/roles/page.tsx) | 1 | `res.ok` only | `useRequireRole(['isSysadmin','isBoardMember'])` → `skip:!ready`. Optimistic role-toggle is an *action* (out of scope). |
| [`app/my-activities/programs/page.tsx:45`](../../src/app/my-activities/programs/page.tsx) | 1 | `res.ok` only | Cleanest case — §5a example. |
| [`app/my-activities/events/page.tsx:57`](../../src/app/my-activities/events/page.tsx) | 1 | `res.ok` only | Trivial. Grouping happens in render. |
| [`app/membership-ops/participants/merge/page.tsx:91`](../../src/app/membership-ops/participants/merge/page.tsx) | **3 sequential/dependent** | `res.ok` only | **Dependent keys** (Decision #3). Candidate-scoring stays in `useMemo`. **`shouldRetryOnError:false`** (Decision #6). Batch 6. |
| [`app/programs/page.tsx:46`](../../src/app/programs/page.tsx) | 1 | `res.ok` only | Trivial. |
| [`app/profile/page.tsx:39`](../../src/app/profile/page.tsx) | 1 | `res.ok` only | Trivial. Error currently via `AlertBanner` tone. |
| [`app/communication/page.tsx:48`](../../src/app/communication/page.tsx) | 1 | `res.ok` only | Trivial. |
| [`app/facility-ops/visits/page.tsx:116`](../../src/app/facility-ops/visits/page.tsx) | 1 | `res.ok` only | `useRequireRole(['isSysadmin'])` → `skip`. 5-key `useMemo` sort stays. |
| [`app/facility-ops/badges/page.tsx:40`](../../src/app/facility-ops/badges/page.tsx) | 1 | `res.ok` only | `useRequireRole(['isSysadmin'])` → `skip`. DataTable owns sort. |
| [`app/program-ops/programs/[id]/page.tsx:107`](../../src/app/program-ops/programs/[id]/page.tsx) | 1 | branches **404** | `useRequireRole([])` (any auth) → `skip`. Client gate broader than the server's per-resource rule → a real **403** path here (gets `AccessGate`). Also has 404 → `variant="notfound"`. |

### 403 → inline access gate (rare — defense-in-depth, see gate analysis)

| File:line | Fetches | Status handling today | Notes |
|---|---|---|---|
| [`app/safety/emergency-contacts/page.tsx:65`](../../src/app/safety/emergency-contacts/page.tsx) | 1 | `res.ok` only (403 swallowed into generic string) | §5b example. `useRequireRole` + inline `AccessGate` on server 403. |
| [`app/safety/board-contacts/page.tsx:30`](../../src/app/safety/board-contacts/page.tsx) | 1 | `res.ok` only | `useRequireRole(['isSysadmin','isBoardMember','isKeyholder'])` — matches server; inline gate ≈ unreachable, migrate for uniformity. |
| [`app/membership-audit/emergency-contacts/page.tsx:29`](../../src/app/membership-audit/emergency-contacts/page.tsx) | 1 | `res.ok` only | **Gated by `membership-audit/layout.tsx`** (`isSysadmin`/`isBoardMember`), which **matches** the server route — client & server agree, inline 403 effectively unreachable. Not a bug; migrate for uniformity, not because a gate is missing. |
| [`app/finance-ops/payment-plan/page.tsx:48`](../../src/app/finance-ops/payment-plan/page.tsx) | 1 | `res.ok` only | `useRequireRole(['isSysadmin','isBoardMember'])`. Error via `AlertBanner` today. |

### Transient + 404 terminal

| File:line | Fetches | Status handling today | Notes |
|---|---|---|---|
| [`app/programs/[id]/page.tsx:65`](../../src/app/programs/[id]/page.tsx) | 1 | branches **404** | Already distinguishes 404 (`"Program not found."`). Maps to `variant="notfound"` + transient retry for the rest. |
| [`app/program-ops/sessions/[id]/page.tsx:101`](../../src/app/program-ops/sessions/[id]/page.tsx) | 1 (+ 4 action mutations) | `res.ok` + a "Not Found" fallback card | Already has the not-found card to mirror in `TerminalState`. The 4 mutations are out of scope (action errors). |

### Admin panels — already inline placeholders (adopt terminal/retry)

Today: loading = `<Center><Loader/></Center>`, error = `<Text c="red">Failed to
load X.</Text>` with **no retry**. Adopting `PageLoader` + `TerminalState`
gives them a retry button.

| File:line | Fetches | Notes |
|---|---|---|
| [`components/admin/AuditLogPanel.tsx:114`](../../src/components/admin/AuditLogPanel.tsx) | 1, filter-driven | Filters → put params in the SWR **key**; refetch-on-filter-change is free, race gone. |
| [`components/admin/LinkStatusPanel.tsx:59`](../../src/components/admin/LinkStatusPanel.tsx) | 1 + reload-on-action | Reload-on-toggle → `mutate()`. |
| [`components/admin/SystemHealthPanels.tsx:225`](../../src/components/admin/SystemHealthPanels.tsx) | `BadgeScanChart` 1; `SystemVersionBox` **3 (2 dependent, GitHub)** | GitHub calls: external, rate-limited → **`shouldRetryOnError:false`** (Decision #6). Dependent keys for main→compare. `BadgeScanChart` currently *silently swallows* errors — surface via `TerminalState`. See Open #1 (should GitHub be live at all). |
| [`components/admin/ErrorLogPanel.tsx:30`](../../src/components/admin/ErrorLogPanel.tsx) | 1 | Trivial. |

### Modal load (currently toasts → re-fold to inline)

| File:line | Notes |
|---|---|
| [`components/admin/AdminEditHouseholdModal.tsx:93`](../../src/components/admin/AdminEditHouseholdModal.tsx) | Load error is a global `notifications.show()` toast today; re-fold into a modal-local `TerminalState`/`Alert` with retry (the modal already has an inline `Alert` for save errors — reuse that surface). Load = `useLoad` keyed on the open household id (`skip` when closed). |

### Coordinate, do not design in isolation

| File:line | Notes |
|---|---|
| [`app/programs/[id]/register/page.tsx:69`](../../src/app/programs/[id]/register/page.tsx) | Public page (no gate), single fetch, `res.ok` only today — a server 403/401 is the only auth signal, so it genuinely exercises the gate/redirect branches. **Being redesigned auth-first in a separate effort** (in flight as of July 6, 2026) — its final auth shape is not settled here. **Dependency: migrate only after that redesign lands** — if you're reading this later, check whether that redesign already shipped before treating this as blocked. Do not assume its final structure. |

Grand total: **24 call sites** across 22 files (`SystemHealthPanels` and
`attendance/current` each host multiple).

---

## 7. Migration sequence

Ordered so each step is a self-contained chip. Foundation first (nothing
migrates until the hook + UI + config exist), then loaders in risk-ascending
batches. Interop (§5) means every batch ships independently.

**Foundation (4 chips, must land first, in order):**
- **0a** — Add `swr` dep + `src/lib/loadFetcher.ts` (`LoadError`, `loadFetcher`,
  `classify`, `onErrorRetry`). Ships with a unit test for `classify`
  (401→unauthenticated, 403→forbidden, 404/400→notfound,
  0/408/429/5xx→transient) and one for the backoff cap (base 2s, ×2, 30s cap,
  stop at K=4).
- **0b** — `src/components/ui/LoadStates.tsx` (`TerminalState`, `AccessGate`;
  `PageLoader` already exists). Pure presentational.
- **0c** — `src/hooks/useLoad.ts` wrapping `useSWR` + the `retrying` attempt
  tracking + the 401 redirect effect. Unit test the state machine
  (transient-retrying vs terminal vs unauthenticated-redirect vs forbidden vs
  notfound).
- **0d** — `<SWRConfig>` into `AuthProvider` with the §4 defaults. No page
  behavior change until a page opts in.

**Migration batches (each its own chip / PR):**
- **Batch 1 — simple transient, no gate:** `my-activities/programs`,
  `my-activities/events`, `programs`, `profile`, `communication`. Proves the
  pattern cheaply (§5a).
- **Batch 2 — transient + `useRequireRole` gate:** `settings/roles`,
  `facility-ops/visits`, `facility-ops/badges`, `program-ops/programs/[id]`
  (also adds `notfound` + the real 403 path).
- **Batch 3 — 403 gate / uniformity:** `safety/emergency-contacts` (§5b),
  `safety/board-contacts`, `membership-audit/emergency-contacts`,
  `finance-ops/payment-plan`. Exercises `AccessGate` end-to-end (mostly
  defense-in-depth per the gate analysis).
- **Batch 4 — 404 terminal:** `programs/[id]`, `program-ops/sessions/[id]`.
- **Batch 5 — admin panels (adopt terminal/retry):** `AuditLogPanel`,
  `LinkStatusPanel`, `ErrorLogPanel`, then `SystemHealthPanels` (GitHub
  `shouldRetryOnError:false` + dependent keys + surface the silent-swallow),
  then `AdminEditHouseholdModal` (toast → inline).
- **Batch 6 — dependent/heavy:** `membership-ops/participants/merge` (3
  sequential, conditional keys, `shouldRetryOnError:false`, scoring stays in
  `useMemo`).
- **Batch 7 — kiosk/polling redesign (own mini-design each):**
  `attendance/certifications` (10s poll + kiosk headers), then
  `attendance/current` (3 fetches + poll + postMessage + kiosk headers). Not
  mechanical swaps — each needs its own mini-design.
- **Coordinate (blocked):** `programs/[id]/register` — after the separate
  auth-first redesign lands.

Rationale: 0a–0d unblock everything; Batch 1 validates the shape at lowest risk;
Batches 2–4 each add exactly one new terminal branch while migrating; Batch 5 is
isolated because the admin panels have their own quirks (GitHub rate limit,
silent-swallow, toast-to-inline); Batches 6–7 need real redesign and are
sequenced last so the pattern is proven before touching the hardest files.
