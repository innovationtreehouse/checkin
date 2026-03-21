/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const certs = (session.user as any)?.toolStatuses || [];
    const hasCertifierAuth = certs.some((ts: any) => ts.level === 'MAY_CERTIFY_OTHERS');

    const isAuthorized = (session.user as any)?.sysadmin ||
        (session.user as any)?.boardMember ||
        (session.user as any)?.shopSteward ||
        hasCertifierAuth;

    if (!isAuthorized) {
        return NextResponse.json({ error: "Forbidden: Requires Shop Steward, Admin, or Certifier role" }, { status: 403 });
    }

    try {
        const members = await prisma.participant.findMany({
            where: {
                OR: [
                    { household: { memberships: { some: { active: true } } } },
                    { memberships: { some: { active: true } } }
                ]
            },
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
