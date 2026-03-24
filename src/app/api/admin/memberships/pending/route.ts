import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    { roles: ["boardMember", "sysadmin"] },
    async (req, auth) => {
        try {
            const pendingHouseholds = await prisma.household.findMany({
                where: {
                    membershipStatus: {
                        in: ["PENDING_BG_CHECK"]
                    }
                },
                include: {
                    leads: {
                        include: { participant: true }
                    },
                    backgroundCheckCertifications: {
                        include: { certifiedBy: true }
                    }
                }
            });

            return NextResponse.json({ households: pendingHouseholds });
        } catch (error) {
            console.error("Error fetching pending memberships:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
