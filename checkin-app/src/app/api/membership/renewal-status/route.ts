import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { nextBoundary } from "@/lib/membership/renewal";

export const dynamic = "force-dynamic";

/**
 * Drives the login-time renewal banner. Returns whether the caller is a household
 * lead whose household has an open renewal awaiting confirmation, plus the due date.
 * Renewal is lead-driven, so only leads see the nudge.
 */
export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await prisma.person.findUnique({
        where: { id: auth.user.id },
        select: { householdId: true, householdLeads: { select: { householdId: true } } },
    });
    if (!user?.householdId) return NextResponse.json({ renewalDue: false });

    const isLead = user.householdLeads.some((l) => l.householdId === user.householdId);
    if (!isLead) return NextResponse.json({ renewalDue: false });

    const open = await prisma.membershipProcess.findFirst({
        where: { kind: "RENEWAL", status: "PENDING_RENEWAL", membership: { householdId: user.householdId } },
        select: { id: true },
    });
    if (!open) return NextResponse.json({ renewalDue: false });

    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 }, select: { membershipYearBoundary: true } });
    const dueDate = settings?.membershipYearBoundary
        ? nextBoundary(settings.membershipYearBoundary, new Date()).toISOString().slice(0, 10)
        : null;

    return NextResponse.json({ renewalDue: true, dueDate });
});
