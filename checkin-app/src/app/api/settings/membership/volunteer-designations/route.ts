import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** GET — list all volunteer email designations. */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async () => {
    const designations = await prisma.volunteerDesignation.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ designations });
});

/**
 * POST — designate an email as a volunteer household. Body: { email }.
 * Non-blocking warning if that email already has an ACTIVE, full-price membership.
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { email?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const email = body.email?.trim().toLowerCase();
    if (!email || !emailRegex.test(email)) {
        return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }

    const existing = await prisma.volunteerDesignation.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ designation: existing, warning: "This email is already designated." });

    // Non-blocking warning: is this email already an active full-price member?
    let warning: string | undefined;
    const participant = await prisma.person.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { household: { select: { membership: { select: { status: true, isVolunteer: true } } } } },
    });
    const m = participant?.household?.membership;
    if (m?.status === "ACTIVE" && !m.isVolunteer) {
        warning = "Heads up: this email already has an active full-price membership. The system can't change that — this designation only applies to their next membership cycle.";
    }

    const designation = await prisma.volunteerDesignation.create({ data: { email, createdById: auth.user.id } });
    return NextResponse.json({ designation, warning }, { status: 201 });
});

/** DELETE — remove a designation. Query: ?id=<n>. */
export const DELETE = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req) => {
    const id = parseInt(new URL(req.url).searchParams.get("id") || "", 10);
    if (isNaN(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await prisma.volunteerDesignation.delete({ where: { id } }).catch(() => null);
    return NextResponse.json({ success: true });
});
