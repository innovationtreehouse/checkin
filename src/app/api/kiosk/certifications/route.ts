import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { getKioskPublicKeys, verifyKioskSignature } from "@/lib/verify-kiosk";

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
                            dob: true,
                            shopSteward: true,
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
                    dob: true,
                    shopSteward: true,
                    toolStatuses: {
                        select: { toolId: true, level: true }
                    }
                }
            });
        }

        const participantsWithAgeCategory = participantsData.map((participant) => {
            const dob = participant.dob;
            let ageCategory = "ADULT";

            if (dob) {
                const birthDate = new Date(dob);
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const m = today.getMonth() - birthDate.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
                if (age < 18) {
                    ageCategory = "STUDENT";
                }
            }

            return {
                id: participant.id,
                email: participant.email,
                name: participant.name,
                shopSteward: participant.shopSteward,
                toolStatuses: participant.toolStatuses,
                ageCategory,
            };
        });

        const tools = await prisma.tool.findMany({
            orderBy: {
                name: "asc"
            },
            select: {
                id: true,
                name: true
            }
        });

        return NextResponse.json({ participants: participantsWithAgeCategory, tools });
    } catch (error) {
        console.error("Certifications fetch error:", error);
        return NextResponse.json(
            { error: "Internal Server Error while fetching certifications." },
            { status: 500 }
        );
    }
}
