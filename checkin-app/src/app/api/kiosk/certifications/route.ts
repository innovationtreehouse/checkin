import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

// Serves the full participant roster + PII (email, name, minor flag, tool certs).
// Same data class as /api/attendance, so the same gate: a valid kiosk signature, or
// a privileged session (sysadmin/boardMember/keyholder). A plain member session gets
// 403 — withAuth handles the kiosk path, role check, denied-household, and local dev.
export const GET = withAuth(
    { roles: ["sysadmin", "boardMember", "keyholder"], allowKiosk: true },
    async (req: NextRequest) => {
    try {
        const url = new URL(req.url);
        const limitToPresent = url.searchParams.get("limit_to_present") !== "false";

        let participantsData;

        if (limitToPresent) {
            const activeVisits = await prisma.visit.findMany({
                where: { departed: null },
                include: {
                    participant: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            toolStatuses: {
                                select: { toolId: true, level: true }
                            }
                        }
                    }
                },
                orderBy: { arrived: "desc" }
            });
            participantsData = activeVisits.map(v => v.participant);
        } else {
            participantsData = await prisma.participant.findMany({
                select: {
                    id: true,
                    email: true,
                    name: true,
                    toolStatuses: {
                        select: { toolId: true, level: true }
                    }
                }
            });
        }

        const participants = participantsData.map((participant) => ({
            id: participant.id,
            email: participant.email,
            name: participant.name,
            toolStatuses: participant.toolStatuses,
        }));

        const tools = await prisma.tool.findMany({
            orderBy: {
                name: "asc"
            },
            select: {
                id: true,
                name: true
            }
        });

        return NextResponse.json({ participants, tools });
    } catch (error) {
        console.error("Certifications fetch error:", error);
        return NextResponse.json(
            { error: "Internal Server Error while fetching certifications." },
            { status: 500 }
        );
    }
});
