import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async (req) => {
        try {
            const url = new URL(req.url);
            const q = url.searchParams.get('q') || '';

            const eighteenYearsAgo = new Date();
            eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

            const participants = await prisma.participant.findMany({
                where: q ? {
                    OR: [
                        { name: { contains: q, mode: 'insensitive' } },
                        { email: { contains: q, mode: 'insensitive' } },
                    ]
                } : {},
                take: 200,
                orderBy: { id: 'desc' },
                include: {
                    memberships: {
                        where: { active: true }
                    },
                    household: {
                        include: {
                            participants: true
                        }
                    }
                }
            });

            const formatted = participants.map(p => ({
                id: p.id,
                name: p.name,
                email: p.email,
                phone: p.phone,
                isMember: p.memberships.length > 0,
                boardMember: p.boardMember,
                shopSteward: p.shopSteward,
                keyholder: p.keyholder,
                household: p.household,
            }));

            return NextResponse.json({ participants: formatted });
        } catch (error) {
            console.error("Failed to fetch participants:", error);
            return NextResponse.json({ error: "Failed to fetch participants" }, { status: 500 });
        }
    }
);
