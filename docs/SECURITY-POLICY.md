# Security Policy Layer

## Why this exists

Three production bugs leaked PII through API responses (#129, #127, #122). The pattern was the same each time: a route handler returned more fields than it should have, no automated check caught it, and a contributor PR sailed through review.

This layer makes that class of bug unmergeable without maintainer review.

## How it works

```
prisma/schema.prisma          ← /// @sensitivity:<tier> on every field
        │ prisma generate
        ▼
src/security/generated/       ← classifications.ts (don't edit by hand)
        │ imported by
        ▼
src/security/registry.ts      ← role × token-grant matrix per endpoint
        │ enforced by
        ▼
src/security/handler.ts       ← every route wraps its logic in handler()
                                — only legal way to ship a response
```

Plus:

- **`scripts/check-route-coverage.ts`** (CI lint) — fails the build on unregistered routes, direct `NextResponse.json` in migrated routes, or third-party `fetch` outside the gateway.
- **`tests/security/policy.contract.test.ts`** — for every (route, role) pair, sends a real request and asserts the response only exposes fields whose tier the view grants.
- **`.github/CODEOWNERS`** — every file above requires maintainer approval to change.

## The token model

Schema annotations classify *data*. Registry views grant *access* in the form of permission tokens.

**Tier** (intrinsic to the field — pure data classification):

| Tier | Meaning |
|---|---|
| `public` | Anyone can see it (Participant.name, Program prices, public roles) |
| `pii` | Personally identifying (email, phone, dob, googleId) |
| `personal` | Private but not identifying (homeAddress, emergency contacts) |
| `internal` | Role/audit metadata (sysadmin flag, lastBackgroundCheck, audit logs) |
| `secret` | Cryptographic — never returned to any client (oauth tokens) |

**Scope** (per-row, computed by the handler for each row in the response):

| Scope | Reads as |
|---|---|
| `everyones` | "everyone's …" — no relationship check (broad grant) |
| `their_own` | "their own …" — row owner is the caller |
| `their_households` | "their households' …" — caller and row owner share a household |
| `their_program_participants` | "their program participants' …" — caller leads/coreVols a program containing the row owner |
| `all_current_visitors` | "all current visitors' …" — keyholder view of people currently in the building |

**Token grammar:**
- `'public'` — bare. Public-tier fields, no row gate.
- `'<scope>:<tier>'` — `tier ∈ {pii, personal, internal}`. Grant applies on rows where the caller holds `<scope>`.
- `'secret'` — never appears in any view (type error at registration).

**Field visibility per row:** a field is exposed iff one of:
1. `field.tier === 'public'` AND view contains `'public'`.
2. View contains `'everyones:<field.tier>'` (unconditional).
3. View contains `'<scope>:<field.tier>'` for some `<scope>` the caller holds on this row.

## Contributor cheatsheet

### Adding a new route

1. Create `src/app/api/your-route/route.ts`:

    ```ts
    import { handler, notFound } from '@/security/handler';
    import prisma from '@/lib/prisma';

    export const GET = handler('GET /api/your-route', async ({ auth }) => {
        const data = await prisma.someModel.findMany();
        return { SomeModel: data };
    });
    ```

2. Register it in `src/security/registry.ts` (this PR will trip CODEOWNERS — that's expected):

    ```ts
    defineRoute({
        endpoint: 'GET /api/your-route',
        authorize: 'authenticated',
        envelope: 'data',
        orderedView: [
            ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
            ['authenticated', ['their_own:pii', 'their_own:personal', 'public']],
            ['anyone',        ['public']],
        ],
    });
    ```

3. Add the endpoint key to `scripts/migrated-routes.txt`.

4. Open the PR. CI will:
    - Run `prisma generate` and assert no diff in `src/security/generated/`.
    - Run the route-coverage lint.
    - Run the contract test against every (endpoint, role) pair.
    - Run the existing suite.

### Adding a new field to a model

1. Add the field in `prisma/schema.prisma` with a `/// @sensitivity:<tier>` comment above it.
2. Run `npx prisma generate` and commit the regenerated `src/security/generated/classifications.ts`.
3. If the field should be exposed: nothing else to do unless its tier isn't already covered. Every existing view that grants `*:<that-tier>` will now expose it automatically. A schema tier change is the policy change; maintainer reviews under CODEOWNERS.

### Aggregated / computed responses (`raw: true`)

A few admin endpoints return values that don't correspond to model rows — daily percentile stats, parse previews, import-success counts. The token-grant stripper can't gate fields that aren't model fields.

For these, declare `raw: true` in the registry. The handler ships your return value verbatim (with the envelope applied if set). `authorize` is the only enforcement; `orderedView` is `[]` by convention:

```ts
defineRoute({
    endpoint: 'GET /api/admin/system-health',
    authorize: { anyRole: ['sysadmin', 'boardMember', 'keyholder'] },
    envelope: null,
    orderedView: [],
    raw: true,
});

// In the route file:
export const GET = handler('GET /api/admin/system-health', async () => {
    const days = computeDailyPercentileStats();
    return { days }; // shipped as-is, no field-stripping
});
```

Use `raw: true` only for genuinely-computed data. If you're returning Prisma model rows, use the normal token-grant flow so the stripper can enforce per-row scopes.

### Sending data to a third party

Use `outboundCall` from `@/security/outbound`:

```ts
// src/lib/shopify.ts
import { outboundCall } from '@/security/outbound';
export async function createShopifyOrder(participant, program) {
    return outboundCall('shopify.order.create',
        { Participant: participant, Program: program },
        async (stripped) => fetch(...));
}
```

Register the surface in `src/security/registry.ts` with the tier list you actually need on the wire — anything else (and `secret` regardless) is stripped before `fetch` ever sees it.

```ts
defineOutbound({
    surface: 'shopify.order.create',
    tiers: ['public'], // Only public fields leave to Shopify.
});
```

## What this layer does NOT cover (yet)

- **Error responses & logs.** The handler returns opaque `Internal Server Error` 500s, but a richer per-route policy (`errorDetail: 'admin-only'`) is future work.
- **AuditLog content.** `oldData`/`newData` JSON blobs can carry any field — they're written before this layer sees them.
- **Server Components.** All pages are currently `"use client"` and hit `/api/`, so the registry covers everything. A future Server Component reading Prisma directly needs to register too.
- **Per-row scope correctness in the generic contract test.** The generic contract asserts every visible field has a grantable tier, but doesn't verify per-row scope-holding (that would require route-specific personas). Route-specific tests (e.g. `programsIdAPI.test.ts`) cover those.
- **Inbound webhook signature verification.** Already handled at `src/app/api/webhooks/shopify/route.ts`.

## What to do if you hit a wall

You found a case the policy doesn't fit cleanly. Don't disable it — open an issue or message a maintainer. The cost of refining the framework is small; the cost of routing around it is the next #129.
