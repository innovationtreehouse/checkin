# Phase 2 Polish Implementation Plan

This document outlines the approach for adding the requested polish features before proceeding to Programs and Events.

## User Review Required

> [!IMPORTANT]
> **Database Changes**: We will need to add a way to store notification preferences on the `Participant` model. Do you prefer adding several boolean flags (e.g., `emailCheckinReceipts Boolean @default(false)`), or a single `notificationSettings Json?` column to handle arbitrary future notification flags? The initial plan is to use a `Json?` field for maximum flexibility.
> 
> **Navigation Update**: Moving the Login/Profile/Preferences to the top right implies we should probably build a persistent Navigation Header (Navbar) that wraps the application via `src/app/layout.tsx`. Does that sound good?

## Proposed Changes

### Database (`prisma/schema.prisma`)
- #### [MODIFY] [schema.prisma](file:///home/dkay/Projects/treehouse/checkmein/prisma/schema.prisma)
  - Add `notificationSettings Json?` to the `Participant` model to store their preferences.
  - Run `npx prisma db push` to apply the changes.

### Navigation & Layout
- #### [NEW] [components/NavBar.tsx](file:///home/dkay/Projects/treehouse/checkmein/src/components/NavBar.tsx)
  - Create a top navigation bar that shows the CheckMeIn logo on the left, and the Profile/Settings/SignOut controls on the top right.
- #### [MODIFY] [app/layout.tsx](file:///home/dkay/Projects/treehouse/checkmein/src/app/layout.tsx)
  - Wrap the `children` in the new `NavBar` component.
- #### [MODIFY] [app/page.tsx](file:///home/dkay/Projects/treehouse/checkmein/src/app/page.tsx)
  - Remove the Profile/Household/SignOut buttons from the main hero dashboard, as they will now live in the global `NavBar`.

### Profile & Notifications
- #### [MODIFY] [app/profile/page.tsx](file:///home/dkay/Projects/treehouse/checkmein/src/app/profile/page.tsx)
  - Add a **Personal History** section fetching past `Visit` records for the user.
  - Add a **Notification Settings** section allowing users to toggle preferences (saving back to the API).
- #### [NEW] [app/api/participant/preferences/route.ts](file:///home/dkay/Projects/treehouse/checkmein/src/app/api/participant/preferences/route.ts)
  - Backend API to GET and PATCH the `notificationSettings` block.

### Household View
- #### [MODIFY] [app/household/page.tsx](file:///home/dkay/Projects/treehouse/checkmein/src/app/household/page.tsx)
  - Add a **Household History** section fetching past `Visit` records for all members of the household.
  - Display extra Household-specific notification options if the user is a `Household Lead` (e.g. "Notify me when my dependents check in").
- #### [NEW] [app/api/household/visits/route.ts](file:///home/dkay/Projects/treehouse/checkmein/src/app/api/household/visits/route.ts)
  - Backend API to fetch past visits of household members.

### Admin Tools
- #### [NEW] [app/admin/events/visits/page.tsx](file:///home/dkay/Projects/treehouse/checkmein/src/app/admin/events/visits/page.tsx)
  - Fetch and display a table of all past `Visit` events.
  - Add an "Edit" button next to past visits.
  - When editing, display a scary confirmation modal: *"Warning: You are editing a past visit record using Admin overrides. This will be permanently logged."*
- #### [NEW] [app/admin/events/badges/page.tsx](file:///home/dkay/Projects/treehouse/checkmein/src/app/admin/events/badges/page.tsx)
  - Fetch and display a table of all `RawBadgeEvent` logs.
- #### [NEW] [app/api/admin/visits/[id]/route.ts](file:///home/dkay/Projects/treehouse/checkmein/src/app/api/admin/visits/[id]/route.ts)
  - API endpoint for admins to mutate historical visits. Will automatically log to `AuditLog`.

## Verification Plan

### Automated Tests
- N/A - we will primarily use manual browser verification to test UI interaction and Admin restrictions.

### Manual Verification
- We will boot the Dev server, login via Mock Auth, and:
  1. Complete check-ins and check-outs as a user.
  2. Verify personal history populates in Profile.
  3. Verify Household history populates for members.
  4. Ensure notification settings save and retrieve successfully.
  5. Attempt to edit the history as an Admin, confirming the confirmation prompt and AuditLog operation.
