import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { LIVE_PERSON } from "@/lib/person/filters";
import { handler } from "@/security/handler";

export const dynamic = "force-dynamic";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** GET — list all volunteer email designations.
 *  Registry-governed: admission anyRole sysadmin/board; envelope 'designations'.
 *  Designation email is pii — covered by the admin band, stripped for any
 *  future role a view adds. */
export const GET = handler('GET /api/settings/membership/volunteer-designations', async () => {
    const designations = await prisma.volunteerDesignation.findMany({ orderBy: { createdAt: "desc" } });
    return { VolunteerDesignation: designations };
});

/**
 * POST — designate an email as a volunteer household. Body: { email }.
 * Non-blocking warning if that email already has an ACTIVE, full-price membership.
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    let body: { email?: string };
    try {
        body = await req.json();
    } catch {
        return apiError("Invalid JSON", 400);
    }
    const email = body.email?.trim().toLowerCase();
    if (!email || !emailRegex.test(email)) {
        return apiError("A valid email is required", 400);
    }

    const existing = await prisma.volunteerDesignation.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ designation: existing, warning: "This email is already designated." });

    // Non-blocking warning: is this email already an active full-price member?
    let warning: string | undefined;
    const participant = await prisma.person.findFirst({
        where: { email: { equals: email, mode: "insensitive" }, ...LIVE_PERSON },
        select: { household: { select: { orgMembership: { select: { status: true, isVolunteer: true } } } } },
    });
    const m = participant?.household?.orgMembership;
    if (m?.status === "ACTIVE" && !m.isVolunteer) {
        warning = "Heads up: this email already has an active full-price membership. The system can't change that — this designation only applies to their next membership cycle.";
    }

    const designation = await prisma.volunteerDesignation.create({ data: { email, createdById: auth.user.id } });
    return NextResponse.json({ designation, warning }, { status: 201 });
});

/** DELETE — remove a designation. Query: ?id=<n>. */
export const DELETE = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req) => {
    const id = parseInt(new URL(req.url).searchParams.get("id") || "", 10);
    if (isNaN(id)) return apiError("id is required", 400);
    await prisma.volunteerDesignation.delete({ where: { id } }).catch(() => null);
    return NextResponse.json({ success: true });
});
