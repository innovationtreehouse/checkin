import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { participantRecordIsActiveMember } from "@/lib/membership";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req) => {
        try {
            const url = new URL(req.url);
            const q = url.searchParams.get('q') || '';

            const eighteenYearsAgo = new Date();
            eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

            const people = await prisma.person.findMany({
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
                            householdMembers: true,
                            membership: true,
                        }
                    }
                }
            });

            const formatted = people.map(p => ({
                id: p.id,
                name: p.name,
                email: p.email,
                phone: p.phone,
                isMember: participantRecordIsActiveMember(p),
                isBoardMember: p.isBoardMember,
                isKeyholder: p.isKeyholder,
                household: p.household,
            }));

            return NextResponse.json({ people: formatted });
        } catch (error) {
            logger.error("Failed to fetch people:", error);
            return NextResponse.json({ error: "Failed to fetch people" }, { status: 500 });
        }
    }
);
