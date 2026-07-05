import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { householdBgIsFresh, nextBoundary } from "@/lib/membership/renewal";

export const dynamic = "force-dynamic";

/**
 * Board-only, PULL-ONLY membership compliance dashboard: households that have
 * fallen out of compliance but were NOT auto-terminated (the system deliberately
 * never auto-revokes — a human must follow up). Surfaces only what's knowable
 * from real data; there is no GRACE status modeled, so no grace bucket. Reasons:
 *   STALE_BG  — ACTIVE household whose background check aged past bgRecheckMonths
 *               (predicate owned by householdBgIsFresh; skipped when the board
 *               hasn't set the policy, i.e. bgRecheckMonths = 0).
 *   REVOKED / DENIED — OrgMembership status.
 *   STUCK_BG_CLEARANCE — a process parked at PENDING_BG_CLEARANCE (paid, never cleared).
 * A household with multiple problems gets all its reason tags.
 */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async () => {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const bgRecheckMonths = settings?.bgRecheckMonths ?? 0;
    const boundary = settings?.orgMembershipYearBoundary
        ? nextBoundary(settings.orgMembershipYearBoundary, new Date())
        : new Date();

    // householdId -> Set<reason>
    const reasons = new Map<number, Set<string>>();
    const add = (householdId: number, reason: string) => {
        const set = reasons.get(householdId) ?? new Set<string>();
        set.add(reason);
        reasons.set(householdId, set);
    };

    // 1. Stale background check — only when the board has configured a window.
    //    Reuse householdBgIsFresh per household (stale = returns false); when
    //    bgRecheckMonths = 0 it always returns false, so skip the whole bucket.
    if (bgRecheckMonths > 0) {
        const active = await prisma.orgMembership.findMany({
            where: { status: "ACTIVE" },
            select: { householdId: true },
        });
        for (const m of active) {
            const fresh = await householdBgIsFresh(m.householdId, boundary, bgRecheckMonths);
            if (!fresh) add(m.householdId, "STALE_BG");
        }
    }

    // 2. REVOKED / DENIED memberships — tag which.
    const revokedDenied = await prisma.orgMembership.findMany({
        where: { status: { in: ["REVOKED", "DENIED"] } },
        select: { householdId: true, status: true },
    });
    for (const m of revokedDenied) add(m.householdId, m.status);

    // 3. Stuck at BG clearance — paid but never cleared.
    const stuck = await prisma.orgMembershipProcess.findMany({
        where: { status: "PENDING_BG_CLEARANCE" },
        select: { orgMembership: { select: { householdId: true } } },
    });
    for (const p of stuck) add(p.orgMembership.householdId, "STUCK_BG_CLEARANCE");

    if (reasons.size === 0) return NextResponse.json({ households: [] });

    const households = await prisma.household.findMany({
        where: { id: { in: [...reasons.keys()] } },
        include: {
            leads: {
                include: {
                    person: { select: { id: true, name: true, phone: true, email: true, lastBackgroundCheck: true } },
                },
            },
        },
        orderBy: { name: "asc" },
    });

    const result = households.map((h) => {
        const checks = h.leads
            .map((l) => l.person.lastBackgroundCheck)
            .filter((d): d is Date => d !== null);
        // Most recent lead check — the date the board is chasing on a STALE_BG row.
        const lastBackgroundCheck = checks.length
            ? checks.reduce((a, b) => (a > b ? a : b)).toISOString()
            : null;
        return {
            id: h.id,
            name: h.name || `Household #${h.id}`,
            reasons: [...(reasons.get(h.id) ?? [])],
            lastBackgroundCheck,
            leads: h.leads.map((l) => ({
                id: l.person.id,
                name: l.person.name,
                phone: l.person.phone,
                email: l.person.email,
            })),
        };
    });

    return NextResponse.json({ households: result });
});
