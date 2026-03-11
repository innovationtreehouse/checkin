/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    const user = session?.user as any;

    if (!user || (!user.sysadmin && !user.boardMember)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get('q') || '';
    const filter = searchParams.get('filter') || 'all';

    const dateFilter = {};
    const now = new Date();

    // Note: Since we don't have a 'createdAt' on Participant, we'll try to use emailVerified 
    // or just return all and let "filter" be a future enhancement if createdAt is added.
    // Wait, let's check prisma schema to see if there's a createdAt. 
    // Schema shows Participant: id, googleId, email, name, emailVerified, image, dob, ...
    // No createdAt. Let's just filter by ID descending to approximate recency.

    const andClauses: any[] = [];

    if (filter === 'adults') {
        const eighteenYearsAgo = new Date(now);
        eighteenYearsAgo.setFullYear(now.getFullYear() - 18);
        andClauses.push({
            OR: [
                { dob: { lte: eighteenYearsAgo } },
                { dob: null }
            ]
        });
        andClauses.push({
            OR: [
                { memberships: { some: { active: true } } },
                { household: { memberships: { some: { active: true } } } }
            ]
        });
    }

    if (q) {
        andClauses.push({
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
            ]
        });
    }

    const whereClause = andClauses.length > 0 ? { AND: andClauses } : {};

    // Since we don't have a creation date on Participant, we will return top 100 recent participants by default 
    // or search matches.

    try {
        const participants = await prisma.participant.findMany({
            where: whereClause,
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
