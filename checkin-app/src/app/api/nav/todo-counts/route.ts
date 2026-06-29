import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import type { MembershipProcessStatus, TrustedAdultReviewStatus } from "@/generated/prisma/client";
import { countHouseholdsMissingValidContact } from "@/lib/emergencyContacts/service";
import { ORG_DOMAIN } from "@/lib/config";

/**
 * Aggregate "things to do" counts for the left-nav badges. Every count is scoped
 * to what the *viewer can actually resolve* — see docs/plan: member keys count
 * only member/household actions, the admin block only the board's own queue.
 * Items blocked on someone else are deliberately excluded (they'd be noise).
 *
 * Predicates are composed from the existing domain modules rather than re-derived:
 *   - membership phases   -> src/lib/membership/phases.ts (member-actionable set)
 *   - renewal             -> PENDING_RENEWAL (member clicks "begin renewal")
 *   - trusted-adult expiry  -> src/lib/trusted-adult/service.ts (WARN_LEAD_DAYS = 30)
 *   - emergency contact   -> same gap the onboarding-status route reports
 */

// Membership process statuses the household itself must act on. Mirrors
// IN_FLIGHT_INITIAL_STATUSES minus the reviewer/board states, plus the
// member-driven PENDING_RENEWAL.
const MEMBER_ACTIONABLE_MEMBERSHIP: MembershipProcessStatus[] = ["INTAKE", "PENDING_EXTERNAL_ACTION", "PENDING_PAYMENT", "PENDING_RENEWAL"];

// Membership statuses the board itself can act on. The board's only
// membership-queue action is overriding/resetting a BLOCKED application
// (governance escape hatch — see overrideBlocked in src/lib/membership/review.ts).
// PENDING_BG_REVIEW / RENEWAL_PENDING_BG are background-check-reviewer (RBAC,
// role backgroundCheckReviewer) work, surfaced by the reviewer notifications
// badge (src/lib/membership/notifications.ts) — NOT the board. The board can
// still SEE those in the applications list, but they don't count here.
const BOARD_ACTIONABLE_MEMBERSHIP: MembershipProcessStatus[] = ["BLOCKED"];

const APPROVED_STATUSES: TrustedAdultReviewStatus[] = ["APPROVED"];

// Same warning lead as runExpirySweep (src/lib/trusted-adult/service.ts).
const WARN_LEAD_DAYS = 30;

/** A single actionable item: what to do, and where to go to do it. */
export type TodoItem = { key: string; label: string; href: string };

export type TodoCounts = {
    // Member buckets are itemized so the UI can show *what* is due, not just a number.
    member: { household: TodoItem[]; programs: TodoItem[] };
    // Informational gray badges (not action items): live building occupancy and
    // how many programs are currently running.
    building: number;
    // Of the people currently in the building, how many belong to the caller's
    // household — lets the Attendance badge show "mine" (green) vs "others" (gray).
    buildingHousehold: number;
    activePrograms: number;
    // Admin keys stay numeric — each admin nav link already deep-links to a page
    // that lists its own queue, so the number is enough.
    // `membership` = board-actionable (BLOCKED, green). `applicationsTotal` =
    // every in-flight (non-ACTIVE) application, the gray count shown on the
    // Applications tab — mirrors what /api/admin/membership lists.
    // `brokenHouseholds` = households with no lead at all (green).
    // `memberFamilies` = total member families (gray), shown on the Manage Memberships tab:
    // households with >=1 non-org-email (or null-email) participant. Staff households hold
    // only the org-email lead, so they fall out.
    admin?: { membership: number; applicationsTotal: number; programsPending: number; trustedAdults: number; householdsMissingContact: number; unclaimedHouseholds: number; brokenHouseholds: number; memberFamilies: number };
};

// What a member-actionable membership process means, in plain terms.
const MEMBERSHIP_TODO_LABEL: Record<string, string> = {
    INTAKE: "Finish your membership application",
    PENDING_EXTERNAL_ACTION: "Sign your membership contract and background-check consent",
    PENDING_PAYMENT: "Pay your membership dues",
    PENDING_RENEWAL: "Confirm your membership renewal",
};

export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = auth.user;

    const warnThreshold = new Date();
    warnThreshold.setUTCDate(warnThreshold.getUTCDate() + WARN_LEAD_DAYS);

    // ---- Member surface (scoped to the caller's household) ----
    const householdTodos: TodoItem[] = [];
    const programTodos: TodoItem[] = [];

    if (user.householdId) {
        const householdId = user.householdId;
        const members = await prisma.participant.findMany({
            where: { householdId },
            select: { id: true },
        });
        const memberIds = members.map((m) => m.id);

        const isLead =
            user.householdLead ??
            (await prisma.householdLead.findFirst({
                where: { householdId, participantId: user.id },
                select: { participantId: true },
            })) !== null;

        const [hh, leadsMissingPhone, membershipProcs, trustedAdultAction, trustedAdultExpiring, pendingPrograms] = await Promise.all([
            isLead
                ? prisma.household.findUnique({
                      where: { id: householdId },
                      select: {
                          // A household needs the todo when it has no valid (non-member,
                          // complete) emergency contact. Emergency contacts are their own entity.
                          emergencyContacts: {
                              where: { conflictParticipantId: null, name: { not: "" }, phone: { not: "" } },
                              select: { id: true },
                              take: 1,
                          },
                      },
                  })
                : Promise.resolve(null),
            // A household lead with no phone on file is an actionable gap — the
            // page highlights the member box; this drives the nav badge count.
            isLead
                ? prisma.householdLead.findMany({
                      where: { householdId, OR: [{ participant: { phone: null } }, { participant: { phone: "" } }] },
                      select: { participant: { select: { id: true, name: true } } },
                  })
                : Promise.resolve([]),
            prisma.membershipProcess.findMany({
                where: { membership: { householdId }, status: { in: MEMBER_ACTIONABLE_MEMBERSHIP } },
                select: { id: true, status: true },
            }),
            prisma.trustedAdultReview.count({
                where: { householdId, status: "PENDING_SUBJECT_ACTION" },
            }),
            prisma.trustedAdultReview.count({
                where: {
                    householdId,
                    status: { in: APPROVED_STATUSES },
                    reviewBy: { not: null, lte: warnThreshold },
                },
            }),
            prisma.programParticipant.findMany({
                where: { participantId: { in: memberIds }, status: "PENDING" },
                select: { programId: true, program: { select: { name: true } } },
            }),
        ]);

        if (!!hh && hh.emergencyContacts.length === 0) {
            householdTodos.push({ key: "emergency-contact", label: "Add a household emergency contact", href: "/my-household#emergency-contact" });
        }
        for (const l of leadsMissingPhone) {
            householdTodos.push({ key: `lead-phone-${l.participant.id}`, label: `Add a phone number for ${l.participant.name ?? "the household lead"}`, href: "/my-household" });
        }
        for (const p of membershipProcs) {
            householdTodos.push({
                key: `membership-${p.id}`,
                label: MEMBERSHIP_TODO_LABEL[p.status] ?? "Continue your membership application",
                href: "/membership",
            });
        }
        for (let i = 0; i < trustedAdultAction; i++) {
            householdTodos.push({ key: `trusted-adult-action-${i}`, label: "Respond to the board's request on a trusted adult", href: "/trusted-adults" });
        }
        for (let i = 0; i < trustedAdultExpiring; i++) {
            householdTodos.push({ key: `trusted-adult-expiring-${i}`, label: "Renew an expiring trusted adult", href: "/trusted-adults" });
        }
        for (const p of pendingPrograms) {
            programTodos.push({
                key: `program-${p.programId}`,
                label: `Complete enrollment for ${p.program?.name ?? "a program"}`,
                href: `/programs/${p.programId}`,
            });
        }
    }

    // Global informational counts (not scoped to the caller).
    const [building, buildingHousehold, activePrograms] = await Promise.all([
        prisma.visit.count({ where: { departedAt: null } }),
        user.householdId
            ? prisma.visit.count({ where: { departedAt: null, participant: { householdId: user.householdId } } })
            : Promise.resolve(0),
        prisma.program.count({ where: { phase: "RUNNING" } }),
    ]);

    const result: TodoCounts = {
        member: { household: householdTodos, programs: programTodos },
        building,
        buildingHousehold,
        activePrograms,
    };

    // ---- Admin surface (board's own queue) — only for board/sysadmin ----
    if (user.sysadmin || user.boardMember) {
        const [membership, applicationsTotal, programsPending, trustedAdults, householdsMissingContact, unclaimedHouseholds, brokenHouseholds, memberFamilies] = await Promise.all([
            prisma.membershipProcess.count({
                where: { status: { in: BOARD_ACTIONABLE_MEMBERSHIP } },
            }),
            // Every in-flight application the Applications page lists (status != ACTIVE).
            prisma.membershipProcess.count({
                where: { status: { not: "ACTIVE" } },
            }),
            prisma.programParticipant.count({
                where: { status: "PENDING", isPaymentPlanRequested: true },
            }),
            prisma.trustedAdultReview.count({
                where: { status: "PENDING_BOARD_REVIEW" },
            }),
            countHouseholdsMissingValidContact(),
            // Households with an account created at registration that nobody has
            // claimed via Google sign-in yet. Mirrors /api/membership-audit/unclaimed-households.
            prisma.household.count({
                where: { participants: { some: { email: { not: null }, googleId: null } } },
            }),
            // "Broken" households: no household lead at all. Mirrors
            // /api/admin/broken-households. Includes empty households.
            prisma.household.count({
                where: { leads: { none: {} } },
            }),
            // Member families: households with >=1 non-org-email participant. A null email is
            // not an org address, but Prisma's `NOT endsWith` skips null rows — list it
            // explicitly so null-email members (e.g. children) count.
            prisma.household.count({
                where: {
                    participants: {
                        some: { OR: [{ email: null }, { NOT: { email: { endsWith: `@${ORG_DOMAIN}` } } }] },
                    },
                },
            }),
        ]);
        result.admin = { membership, applicationsTotal, programsPending, trustedAdults, householdsMissingContact, unclaimedHouseholds, brokenHouseholds, memberFamilies };
    }

    return NextResponse.json(result);
});
