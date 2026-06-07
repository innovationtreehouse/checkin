# CheckMeIn — Critical User Journeys (CUJs)

All user-facing flows implemented in the system, organized by persona.

---

## 1. Any Visitor (Unauthenticated)

| # | Journey | Route | Description |
|---|---------|-------|-------------|
| 1.1 | **Google Sign-In** | `/` | Sign in with Google OAuth. On first login, a Participant record is auto-created and linked. |
| 1.2 | **Browse Public Programs** | `/programs` | View the directory of active programs (public ones visible without login, member-only hidden). |

---

## 2. Participant (Authenticated User)

| # | Journey | Route | Description |
|---|---------|-------|-------------|
| 2.1 | **Dashboard / Home** | `/` | After login, see personalized dashboard with check-in status, quick links, and minor indicators for household children. |
| 2.2 | **Toggle Check-In / Check-Out** | `/` | One-click button to check in or out of the facility. |
| 2.3 | **View Attendance Log** | `/attendance` | See who is currently checked in, search participants, and view their own attendance status. |
| 2.4 | **Manual Time Entry** | `/attendance/manual` | Self-correct a forgotten badge scan by entering arrival/departure times retroactively. |
| 2.5 | **Edit Profile** | `/profile` | Update personal info (name, phone, address, DOB) and notification preferences (email, text, Slack toggles for entry/exit events). |
| 2.6 | **View Program Details & Enroll** | `/programs/[id]` | View a program's schedule and self-enroll (with age/capacity validation; admins can override). |
| 2.7 | **My Upcoming Events** | `/dashboard/events` | See all upcoming events for enrolled programs and RSVP (Yes / Maybe / No). |
| 2.8 | **My Enrolled Programs** | `/dashboard/programs` | View list of programs the participant is currently enrolled in. |

---

## 3. Household Lead (Parent / Guardian)

| # | Journey | Route | Description |
|---|---------|-------|-------------|
| 3.1 | **Create Household** | `/household` | If not in a household, create one (auto-joined as lead). |
| 3.2 | **Add Adult to Household** | `/household` | Invite another adult by email. If the email has no existing account, a placeholder is created and linked on first Google login. |
| 3.3 | **Add/Edit Household Members** | `/household` | Add members to the household with name, DOB, and optional email. Edit existing member details (name, email, DOB). |
| 3.4 | **Notification Settings** | `/household` | Configure per-member notifications — toggle email/text/Slack alerts for entry and exit events. |
| 3.5 | **View Household Visits** | `/household` | See recent visit history (arrival/departure) for all household members. |

---

## 4. Keyholder

| # | Journey | Route | Description |
|---|---------|-------|-------------|
| 4.1 | **Force Check-Out** | `/attendance` | As a keyholder viewing the attendance dashboard, force-checkout any currently checked-in participant (e.g., ghost users at closing time). |
| 4.2 | **Manual Check-In (on behalf)** | `/attendance` | Search for a participant and check them in on their behalf (e.g., they forgot their badge). |

---

## 5. Tool Certifier / Shop Steward

| # | Journey | Route | Description |
|---|---------|-------|-------------|
| 5.1 | **Shop Ops Hub** | `/shop` | Central landing page for shop operations; links to Create Tool and Manage Certifications (role-gated). |
| 5.2 | **Grant/Change Certification** | `/shop/tools` | Select a tool, select a member, and grant a certification level (Basic → DoF → Certified → Certifier). Includes promotion/demotion confirmation dialog. |
| 5.3 | **View Certified Members per Tool** | `/shop/tools` | After selecting a tool, see all certified members and their levels. |
| 5.4 | **Search Tools** | `/shop/tools` | Filter the tool list by name using the search input. |

---

## 6. Program Leader / Admin

| # | Journey | Route | Description |
|---|---------|-------|-------------|
| 6.1 | **Create Program** | `/admin/programs/new` | Define a new program with name, date range, and member-only flag. |
| 6.2 | **Manage Program Settings** | `/admin/programs/[id]` | Edit program name, dates, lead mentor, min age, max participants, member-only flag, and published status. |
| 6.3 | **Manage Program Roster** | `/admin/programs/[id]` | Add/remove enrolled participants and volunteers from a program. |
| 6.4 | **Browse All Programs** | `/admin/programs` | View table of all programs with counts (participants, volunteers, events). Filter by active-only. |
| 6.5 | **Create Event (for a Program)** | `/admin/events/new` | Schedule a one-time or recurring event tied to a program, with day-of-week selection. |

---

## 7. Board Member / Sysadmin

| # | Journey | Route | Description |
|---|---------|-------|-------------|
| 7.1 | **Admin Hub** | `/admin` | Central admin dashboard with alerts (orphan students) and links to all admin tools. |
| 7.2 | **Role Assignment** | `/admin/roles` | Toggle roles (Sysadmin, Board Member, Keyholder, Shop Steward) for any participant. |
| 7.3 | **Manage Memberships** | `/admin/households` | View all households and grant/revoke active facility membership per household. |
| 7.4 | **Register New Participant** | `/admin/participants/new` | Manually pre-create a user (adult or minor) before their first Google login. For minors, associate with a parent email (auto-creates parent placeholder if needed). |
| 7.5 | **Orphan Student Alerts** | `/admin` | Dashboard alert showing students whose parent accounts have not yet been claimed. |
| 7.6 | **View/Edit Historical Visits** | `/admin/events/visits` | View all past visit records and edit arrival/departure times (with date filtering). |
| 7.7 | **Audit Raw Badge Events** | `/admin/events/badges` | View raw RFID badge tap log (sysadmin only) for audit purposes. |
| 7.8 | **Create Tool** | `/shop/tools/new` | Register a new piece of shop equipment with an optional safety guide URL. |

---

## 8. System / Background

| # | Journey | Route | Description |
|---|---------|-------|-------------|
| 8.1 | **Badge Scan (Kiosk)** | `POST /api/scan` | Raspberry Pi kiosk posts badge scans; system auto-creates visit (check-in) or closes visit (check-out). |
| 8.2 | **Cron: Event Reminders** | `GET /api/cron/reminders` | Scheduled job sends reminders for upcoming events. |
| 8.3 | **Audit Logging** | Various APIs | All sensitive mutations (role changes, certification changes, visit edits) log to the `AuditLog` table with actor, action, old/new data. |
