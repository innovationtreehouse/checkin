import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { getKioskPublicKeys, verifyKioskSignature } from "@/lib/verify-kiosk";
import { config } from "@/lib/config";

export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        const hasKioskHeaders = req.headers.get("x-kiosk-signature");
        const pubKeys = getKioskPublicKeys();

        if (!session && pubKeys.length > 0 && hasKioskHeaders) {
            const result = verifyKioskSignature(
                "GET",
                "/api/kiosk/certifications",
                "",
                req.headers.get("x-kiosk-timestamp"),
                req.headers.get("x-kiosk-signature"),
                pubKeys
            );
            if (!result.ok) {
                return NextResponse.json({ error: result.error }, { status: result.status });
            }
        } else if (!session && pubKeys.length > 0) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        } else if (!session && !config.isLocal()) {
            // No session and no kiosk key configured (pubKeys empty). Outside local dev
            // this must fail closed — otherwise an unset KIOSK_PUBLIC_KEY would serve all
            // participants' PII (email, name, age, certifications) to anonymous callers.
            // Mirrors the keyless-kiosk gating in src/lib/auth.ts.
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

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
}
