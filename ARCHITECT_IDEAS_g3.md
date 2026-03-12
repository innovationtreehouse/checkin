# Architectural Opportunities for checkmein

After building out the extensive feature set of the `checkmein` application, we have identified several opportunities to re-architect parts of the system. These improvements aim to enhance performance, increase code readability, reduce duplication, and solidify security practices.

## 1. UI Component Reusability & Design System
**Current State:** UI elements like buttons, modals, badges, and tables are frequently duplicated across different pages (e.g., `/admin`, `/kioskdisplay`, `/shop`).
**Opportunity:**
- **Shared Component Library:** Create a `src/components/ui/` directory containing atomic React components (`Button`, `Modal`, `Table`, `Input`, `Select`, `Card`).
- **Benefits:** 
  - Drastically reduces duplicated markup and styling.
  - Ensures visual consistency across the entire application.
  - Makes page files (`page.tsx`) much smaller and easier to read.
  - Easier to update the design globally (e.g., changing the primary color suite).

## 2. API Route Architecture & Business Logic Extraction
**Current State:** Business logic is often tightly coupled with Next.js Route Handlers (`app/api/*`). Each route handles its own validation, database access, and formatting.
**Opportunity:**
- **Service Layer (Domain-Driven Design):** Move complex business logic out of route handlers and into dedicated service files (e.g., `src/services/attendance.service.ts`, `src/services/household.service.ts`). Route handlers should only parse requests, call services, and return HTTP responses.
- **Centralized Validation:** Use a validation schema library like **Zod** to stringently parse incoming API payloads. This prevents malformed data from reaching the service layer.
- **Unified Error Handling:** Create a wrapper function for API routes that automatically catches thrown errors, logs them, and returns standard HTTP error responses (e.g., `withErrorHandler(handler)`).

## 3. Database & System Performance
**Current State:** The Postgres database manages high-frequency writes (e.g., `RawBadgeEvent`, `SystemMetric`, `AuditLog`) alongside critical relational reads.
**Opportunity:**
- **Database Indexing:** Add explicit composite and single-column indexes in `prisma/schema.prisma` for frequently queried fields, such as `Visit.arrived`, `Event.start`, and `Membership.active`. This will speed up the new metrics aggregates and kiosk loading times.
- **Caching Strategy:** Implement aggressive caching for read-heavy, low-churn routes (like the list of Tools, historical Events, or active Programs) using Next.js `unstable_cache` or standard cache headers.
- **Log Rotation / Offloading:** The newly implemented `ErrorLog`, `AuditLog`, and `SystemMetric` tables will grow indefinitely. We should implement a cron job to prune old records (e.g., older than 90 days), or better yet, migrate high-volume telemetry to an external time-series database or logging service (like Sentry or Datadog) to reduce load on the primary relational database.

## 4. Simplified Security & Authorization
**Current State:** Role checks (`user.sysadmin`, `user.keyholder`, etc.) are likely evaluated independently in various API routes and UI components.
**Opportunity:**
- **Centralized Permissions Map:** Define a single source of truth for authorization (e.g., a `permissions.ts` file) that maps actions to required roles.
- **Edge Middleware for Auth:** Utilize Next.js `middleware.ts` to protect the `/admin/*` routes at the Edge. This rejects unauthorized requests before they ever spin up the Node runtime or query the database, saving server resources and tightening security.
- **Higher-Order Route Protection:** Create server-side wrappers like `withAuth(requireAdmin: true, handler)` to ensure consistent permission validation on API endpoints without rewriting `if (!user.sysadmin) return 403` everywhere.

## 5. React Server Components (RSC) vs Client Boundaries
**Current State:** Often throughout rapid development, large sections of the UI become Client Components (`"use client"`) because one or two child elements require state or interactivity.
**Opportunity:**
- **Push Interactivity to the Leaves:** Refactor pages by pushing `"use client"` directives down to the smallest possible interactive sub-components.
- **Benefits:** Maximizes the use of React Server Components, which reduces JavaScript bundle sizes sent to the browser, eliminates data-fetching waterfalls, and significantly improves the initial page load speed for complex views like the Admin Dashboard.

## 6. Code Organization (Vertical Slices)
**Current State:** Files are organized strictly by Next.js technical concern: `app/` for routing, `lib/` for helpers, `components/` for UI.
**Opportunity:**
- **Feature-Based Structure:** Consider grouping code by feature domain (e.g., `src/features/Attendance/`, `src/features/Households/`, `src/features/Programs/`). Each folder would contain its own internal components, hooks, services, and types. This makes navigating the codebase much easier for new developers, as all code related to a specific domain lives together.
