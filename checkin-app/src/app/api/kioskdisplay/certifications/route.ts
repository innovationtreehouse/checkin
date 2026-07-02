import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

// Serves the participant roster for the tool-certification grid: id, a display name, and
// tool certs. The raw email is read only to resolve the name fallback and never leaves the
// DB (#329). Same data class as /api/attendance, so the same gate: a valid kiosk signature, or
// a privileged session (isSysadmin/isBoardMember/isKeyholder). A plain member session gets
// 403 — withAuth handles the kiosk path, role check, denied-household, and local dev.
export const GET = withAuth(
    { roles: ["isSysadmin", "isBoardMember", "isKeyholder"], allowKiosk: true },
    async (req: NextRequest) => {
    try {
        const url = new URL(req.url);
        const limitToPresent = url.searchParams.get("limit_to_present") !== "false";

        let participantsData;

        if (limitToPresent) {
            const activeVisits = await prisma.visit.findMany({
                where: { departedAt: null },
                include: {
                    person: {
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
                orderBy: { arrivedAt: "desc" }
            });
            participantsData = activeVisits.map(v => v.person);
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
            // The grid only ever shows a display name, so resolve the name-or-email-prefix
            // fallback here and drop the raw address from the response (#329).
            name: participant.name?.trim() || participant.email?.split("@")[0] || "",
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
