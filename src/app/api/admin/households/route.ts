import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async (req) => {
        try {
            const url = new URL(req.url);
            const id = url.searchParams.get('id');
            const q = url.searchParams.get('q') || '';

            if (id) {
                const household = await prisma.household.findUnique({
                    where: { id: parseInt(id) },
                    include: {
                        participants: {
                            select: { id: true, name: true, email: true }
                        },
                        membership: true
                    }
                });
                return NextResponse.json({ household });
            }

            const whereClause = q ? {
                OR: [
                    { name: { contains: q, mode: 'insensitive' as const } },
                    { participants: { some: { name: { contains: q, mode: 'insensitive' as const } } } },
                    { participants: { some: { email: { contains: q, mode: 'insensitive' as const } } } },
                ]
            } : {};

            const households = await prisma.household.findMany({
                where: whereClause,
                include: {
                    participants: {
                        select: { id: true, name: true, email: true }
                    },
                    membership: true
                },
                orderBy: {
                    id: 'desc'
                },
                ...(q && { take: 20 })
            });

            return NextResponse.json({ households });
        } catch (error) {
            console.error("Failed to fetch households:", error);
            return NextResponse.json({ error: "Failed to fetch households" }, { status: 500 });
        }
    }
);

export const POST = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async (req) => {
        try {
            const body = await req.json();
            const { householdId, active } = body;

            if (!householdId) {
                return NextResponse.json({ error: "Household ID is required" }, { status: 400 });
            }

            const existingMembership = await prisma.membership.findUnique({
                where: { householdId }
            });

            if (active) {
                const membership = await prisma.membership.upsert({
                    where: { householdId },
                    create: { householdId, status: "ACTIVE" },
                    update: { status: "ACTIVE" }
                });
                return NextResponse.json({ success: true, membership });
            } else if (existingMembership && existingMembership.status === "ACTIVE") {
                await prisma.membership.update({
                    where: { householdId },
                    data: { status: "REVOKED" }
                });
                return NextResponse.json({ success: true, message: "Membership deactivated" });
            }

            return NextResponse.json({ success: true, message: "No change needed" });
        } catch (error) {
            console.error("Failed to update household membership:", error);
            return NextResponse.json({ error: "Failed to update membership" }, { status: 500 });
        }
    }
);
