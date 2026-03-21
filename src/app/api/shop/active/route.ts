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
        const activeVisits = await prisma.visit.findMany({
            where: { departed: null },
            include: {
                participant: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        toolStatuses: {
                            include: { tool: true }
                        }
                    }
                }
            }
        });

        const occupants = activeVisits.map(visit => ({
            visitId: visit.id,
            arrived: visit.arrived,
            participant: visit.participant
        }));

        return NextResponse.json(occupants);
    } catch (error) {
        console.error("Failed to fetch active shop users:", error);
        return NextResponse.json({ error: "Failed to fetch active users" }, { status: 500 });
    }
}
