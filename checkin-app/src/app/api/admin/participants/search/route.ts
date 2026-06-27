import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { participantRecordIsActiveMember } from "@/lib/membership";

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
                    household: {
                        include: {
                            participants: true,
                            membership: true,
                        }
                    }
                }
            });

            const formatted = participants.map(p => ({
                id: p.id,
                name: p.name,
                email: p.email,
                phone: p.phone,
                isMember: participantRecordIsActiveMember(p),
                boardMember: p.boardMember,
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
