# Eliminating `dangerously_allow_all_data_access`

> Status: design proposal (2026-05-14). 23 routes currently bypass the field-level stripper. This doc categorizes them by *why* they bypass, proposes a small set of registered **response transformers** in `src/security/` (CODEOWNERS-gated), and maps each bypass to the transformer that would replace it.
>
> Goal: drive `dangerously_allow_all_data_access` to zero by giving handlers expressive, *narrow* primitives instead of a single all-or-nothing bypass flag.

## Why the bypass exists today

`src/security/handler.ts` ships one of two body shapes:

```typescript
if (spec.dangerously_allow_all_data_access) {
    body = spec.envelope === null ? bag : { [spec.envelope]: bag };
} else {
    const stripped = stripBag(bag, viewTokens, callerCtx);
    ...
}
```

The non-bypass path assumes the handler returns a `ModelBag` — a record keyed by Prisma model name, with each value a row (or array of rows) of that model. `stripBag` then walks each row applying per-field tier checks against the caller's view tokens.

Five recurring situations break that assumption today:

1. **The response isn't model rows** — counts, percentile stats, parse previews, success acks.
2. **The response shape varies by request action** — `body.action='cancel'` returns `{success}` while `body.action='editTime'` returns a row.
3. **Row scope is per-action, not per-route** — multi-shape attendance responses have different per-role envelopes built in-handler.
4. **The caller has no scope-resolver mapping** — kiosk auth has no `selfId`, so the stripper has no scope to apply to rows.
5. **The caller's session context is stale within the request** — the just-created Household isn't yet recognized as the caller's `their_households` row (the special case we hit during the Household review).

Every existing bypass falls into one or more of those buckets.

## The 23 bypasses, categorized

| # | Endpoint | Bucket | Replacement |
|---|---|---|---|
| 1 | `GET /api/admin/system-health` | Aggregate stats | `aggregate` |
| 2 | `GET /api/admin/trends` | Aggregate stats | `aggregate` |
| 3 | `POST /api/admin/participants/import` | Operational ack | `ack` |
| 4 | `POST /api/admin/participants/import/preview` | Caller-derived preview | `derivedFromInput` |
| 5 | `POST /api/household` | Stale-self context | `withFreshContext` |
| 6 | `POST /api/profile/onboarding` | Operational ack | `ack` |
| 7 | `GET /api/profile/onboarding-status` | Self scalars + booleans | `selfScalars` |
| 8 | `GET /api/kiosk/certifications` | Kiosk-context rows | `kioskScope` + `computedField` |
| 9 | `GET /api/kiosk/version` | Process metadata | `processMeta` |
| 10 | `GET /api/health` | Process metadata | `processMeta` |
| 11 | `POST /api/events` | Bulk-write ack (`{count}`) | `ack` |
| 12 | `PATCH /api/events/[id]` | Action-dispatched multi-shape | `actionDispatch` |
| 13 | `POST /api/events/[id]/attendance` | Bulk-write ack (`{processed}`) | `ack` |
| 14 | `GET /api/attendance` | Action-dispatched multi-shape | `actionDispatch` |
| 15 | `POST /api/attendance` | Action-dispatched multi-shape | `actionDispatch` |
| 16 | `GET /api/cron/nightly` | Operational ack (nested counts) | `ack` |
| 17 | `GET /api/cron/pending-participants` | Operational ack | `ack` |
| 18 | `GET /api/cron/post-event` | Operational ack | `ack` |
| 19 | `GET /api/cron/reminders` | Operational ack | `ack` |
| 20 | `GET /api/auth/dev-personas` | Dev-only fixture | `devOnly` (env-gated) |
| 21 | `POST /api/programs/[id]/public-register` | Self-form ack with side effect | `ack` |
| 22 | `POST /api/scan` | Kiosk-context multi-shape | `kioskScope` + `actionDispatch` |
| 23 | `POST /api/webhooks/shopify` | Webhook 200 ack | `ack` |

## Proposed transformers

Each transformer is a separately registered primitive in `src/security/transformers/`. The directory is already inside CODEOWNERS — adding a transformer requires maintainer review, but *using* an existing transformer in a route is a normal PR.

`RouteSpec` would grow a discriminated `transform` field replacing the boolean bypass:

```typescript
interface RouteSpec {
    endpoint: string;
    authorize: Authorize;
    envelope: Envelope;
    orderedView: readonly OrderedViewEntry[];
    transform?: TransformSpec;  // replaces dangerously_allow_all_data_access
}

type TransformSpec =
    | { kind: 'aggregate'; shape: AggregateShape }
    | { kind: 'ack'; fields: AckFieldSpec }
    | { kind: 'derivedFromInput' }
    | { kind: 'selfScalars'; participantFields?: ReadonlyArray<keyof Participant>;
                              householdFields?: ReadonlyArray<keyof Household>;
                              computedBooleans?: readonly string[] }
    | { kind: 'computedField'; name: string; from: { model: ModelName; fields: readonly string[] }; tier: Tier }
    | { kind: 'actionDispatch'; byAction: Record<string, ActionBranch> }
    | { kind: 'kioskScope' }  // composes with stripper
    | { kind: 'processMeta' }
    | { kind: 'withFreshContext' }
    | { kind: 'devOnly' };
```

### 1. `aggregate` — for computed/derived statistics

```typescript
transform: {
    kind: 'aggregate',
    shape: { buckets: 'array<{date, count, p50, p90, p99}>' }
}
```

The handler return is validated against the declared shape (no fields outside the contract); model-tier checks are skipped because no Prisma rows are in the response. Code owners maintain a registry of approved aggregate shapes.

**Replaces:** `/api/admin/system-health`, `/api/admin/trends`.

### 2. `ack` — for write-only success/count responses

```typescript
transform: {
    kind: 'ack',
    fields: { success: 'boolean', count: 'number?', message: 'string?',
              processed: 'number?', errors: 'array<string>?' }
}
```

Restricted vocabulary of allowed keys (`success`, `count`, `processed`, `kicked`, `warned`, `errors`, `message`, `notificationsSent`, etc. — maintained by code owners). Handler return is shape-checked. Any unknown key fails the route at runtime *and* `check-route-coverage` lint.

**Replaces:** `/api/admin/participants/import`, `/api/profile/onboarding`, `POST /api/events` (returns `{count}`), `/api/events/[id]/attendance` (`{processed}`), all 4 cron routes, `/api/programs/[id]/public-register`, `/api/webhooks/shopify`. **8 routes.**

### 3. `derivedFromInput` — for previews of caller's own uploaded data

```typescript
transform: { kind: 'derivedFromInput' }
```

Asserts: the response is derived purely from request input (uploaded file, request body parsing), not from DB rows. The framework verifies that no Prisma client call was made on the request path (via a per-request tracer — instrument the prisma client in test/dev mode).

**Replaces:** `/api/admin/participants/import/preview`.

### 4. `selfScalars` — for caller's own row fields plus computed booleans

```typescript
transform: {
    kind: 'selfScalars',
    participantFields: ['phone'],
    householdFields: ['emergencyContactName', 'emergencyContactPhone'],
    computedBooleans: ['needsPhone', 'isLead', 'needsEmergencyContact']
}
```

Authorize must be `'self'`. The framework runs the stripper against the caller's own Participant + Household with `everyones:*` tokens scoped to the declared field allow-list. The computed booleans are validated as `boolean`-typed in the handler return.

**Replaces:** `/api/profile/onboarding-status`.

### 5. `computedField` — for row responses augmented with derived values

```typescript
transform: {
    kind: 'computedField',
    name: 'ageCategory',
    from: { model: 'Participant', fields: ['dob'] },
    tier: 'public'
}
```

The handler returns a normal `ModelBag` with the computed field present on each row. The stripper:
1. strips the `from.fields` per their classification tier,
2. preserves the named computed field at the declared `tier`.

Multiple `computedField` transformers can compose (use an array form).

**Replaces:** the *computed-field* portion of `/api/kiosk/certifications`. Combined with `kioskScope` (below), the route is no longer a bypass.

### 6. `kioskScope` — gives kiosk auth a real `Scope` mapping

Kiosk callers currently have no scope-resolver entry because there's no `selfId`. Instead, define:

```typescript
type CallerContext = {
    ...existing,
    kioskActiveVisitors: Set<number>;  // populated for kiosk auth
}
```

Add scope resolution: when role `kiosk`, any row whose `participantId ∈ kioskActiveVisitors` adds `all_current_visitors` to its scope set. Then a kiosk view can grant `['all_current_visitors:pii', 'all_current_visitors:personal']` and the stripper just works.

This isn't a new transformer kind; it's an upgrade to the scope-resolver layer. With it in place, `kioskScope` is a marker that says "this route admits kiosk auth and the kiosk visitor-set mapping should be populated."

**Replaces (in part):** `/api/kiosk/certifications`, `/api/scan`.

### 7. `actionDispatch` — for routes whose response shape varies by request action

```typescript
transform: {
    kind: 'actionDispatch',
    byAction: {
        editTime: { envelope: 'event', orderedView: [...] },
        cancel: { transform: { kind: 'ack', fields: { success: 'boolean' } } },
        confirmAttendance: { transform: { kind: 'ack', fields: { success: 'boolean' } } },
        manualEditAttendance: { envelope: 'event', orderedView: [...] },
    }
}
```

The framework reads `body.action` (or a declared discriminant key) and applies the matching branch — either a normal envelope + stripper pipeline, or a nested `transform`. CODEOWNERS-gated since the discriminant field is policy.

**Replaces:** `PATCH /api/events/[id]`, `GET /api/attendance`, `POST /api/attendance`, `POST /api/scan`.

### 8. `processMeta` — for non-DB liveness/version responses

```typescript
transform: { kind: 'processMeta' }
```

The framework verifies that no Prisma call was issued during the request (same tracer as `derivedFromInput`). Response shape is restricted to a small allow-list (`{status, version, uptime, gitSha, env, region}` etc.).

**Replaces:** `/api/health`, `/api/kiosk/version`.

### 9. `withFreshContext` — for write-then-read-self of just-created entities

```typescript
transform: { kind: 'withFreshContext' }
```

The framework recomputes `callerContext` after the handler runs (re-reads `Participant.findUnique` for the caller) so that newly-established relationships are visible to the stripper. Then runs the normal stripper pipeline.

**Replaces:** `POST /api/household`.

### 10. `devOnly` — for dev-environment-gated routes

```typescript
transform: { kind: 'devOnly' }
```

Asserts: the route is unreachable when `process.env.NEXT_PUBLIC_DEV_AUTH !== '1'`, AND the build pipeline strips this route from production bundles (currently the case for `/api/auth/dev-personas`). The handler return can be any shape; field-level stripping is skipped because the route shouldn't exist in prod.

A `check-route-coverage` lint check would assert the dev gate is wired correctly.

**Replaces:** `/api/auth/dev-personas`.

## Migration plan

Phase 1 — **infrastructure (foundational, no route changes):**
1. Add the `TransformSpec` discriminated union to `core.ts`.
2. Wire `handler.ts` to dispatch on `transform.kind` after the auth/role steps.
3. Keep `dangerously_allow_all_data_access` working for now (deprecation period).
4. Instrument the Prisma client with an AsyncLocalStorage tracer so `derivedFromInput` and `processMeta` can assert no-DB-calls. Behind `NODE_ENV !== 'production'` for cost; `check-route-coverage` runs these in test mode.

Phase 2 — **straightforward transformers (high count, low risk):**
5. Implement `ack` and `processMeta`. Migrate 8 + 2 = **10 routes**.
6. Implement `aggregate` with a starter shape registry. Migrate 2 routes.

Phase 3 — **per-context transformers:**
7. Implement `selfScalars`. Migrate `/api/profile/onboarding-status`.
8. Implement `withFreshContext`. Migrate `POST /api/household`.
9. Implement `derivedFromInput`. Migrate `/api/admin/participants/import/preview`.
10. Implement `devOnly`. Migrate `/api/auth/dev-personas`.

Phase 4 — **multi-shape (highest design surface):**
11. Implement `actionDispatch`. Migrate the 4 multi-shape attendance/event/scan routes. Each branch goes through the normal stripper pipeline or a nested transformer.

Phase 5 — **kiosk scope:**
12. Add `kioskActiveVisitors` to `CallerContext` + scope resolver. Implement `kioskScope` marker.
13. Combine with `computedField` for `/api/kiosk/certifications`.
14. Combine with `actionDispatch` for `/api/scan`.

Phase 6 — **lockdown:**
15. Remove `dangerously_allow_all_data_access` from `RouteSpec`.
16. Update CI lint to forbid the field name entirely.

## Open questions

- **Aggregate shape registry**: free-form schema (Zod / arktype / similar) vs. fixed allowlist of named shapes (`'percentile-bucket'`, `'period-summary'`, etc.). Named-shape is stricter; free-form is easier to extend. Recommendation: start with named-shape — forces every new aggregate response through a CODEOWNERS-gated naming step.

- **Action discriminant**: always `body.action`, or per-route configurable? Recommendation: always `body.action`, enforced by the type system. The 4 affected routes already use that key.

- **Prisma tracer cost**: an AsyncLocalStorage wrapper around the prisma proxy adds a measurable per-call overhead. Recommendation: skip it in production; rely on `check-route-coverage`'s test-run to enforce the no-DB contract for `derivedFromInput` / `processMeta` routes.

- **`withFreshContext`** is the only one that re-queries the DB inside the framework. Two queries instead of one is fine for the just-created-entity case; would be expensive if applied broadly. Recommendation: limit it to single-row creates; flag any handler using it that does >1 prisma writes before returning.

## What this gets us

- **Stripper bypasses go to zero** — every route's response shape is either policy-checked (rows via the stripper) or shape-checked (ack/aggregate/processMeta).
- **CODEOWNERS leverage is preserved** — the transformer kinds live in `src/security/`, so a contributor can use a transformer but can't add a new transformer kind without maintainer review.
- **Future PII leaks at the response-shape level are caught at compile time** — `ack` and `aggregate` have typed shape contracts; using `selfScalars` with a non-self route is a type error.
- **Each remaining manual decision is small** — the dangerous bypass becomes ~9 narrow primitives, each with a clear intent and review surface.
