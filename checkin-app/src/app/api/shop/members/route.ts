import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { ACTIVE_MEMBER_PARTICIPANT_WHERE } from "@/lib/membership";

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const certs = session.user?.toolStatuses || [];
    const hasCertifierAuth = certs.some((ts: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => ts.level === 'MAY_CERTIFY_OTHERS');

    const isAuthorized = session.user?.sysadmin ||
        session.user?.boardMember ||
        session.user?.shopSteward ||
        hasCertifierAuth;

    if (!isAuthorized) {
        return NextResponse.json({ error: "Forbidden: Requires Shop Steward, Admin, or Certifier role" }, { status: 403 });
    }

    try {
        const members = await prisma.participant.findMany({
            where: ACTIVE_MEMBER_PARTICIPANT_WHERE,
            select: {
                id: true,
                name: true,
                email: true,
            },
            orderBy: {
                name: 'asc'
            }
        });

        return NextResponse.json({ members });
    } catch (error) {
        console.error("Failed to fetch shop members:", error);
        return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
    }
}
