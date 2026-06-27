import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { createShopifyProgramVariants } from "@/lib/shopify";
import { logBackendError } from "@/lib/logger";
import { isActiveMember } from "@/lib/membership";
import { dollarsToCentsOrNull } from "@inventory/money";

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    try {
        const { searchParams } = new URL(req.url);
        const activeOnly = searchParams.get("active") === "true";

        // Determine if the user is allowed to see memberOnly programs
        let canSeeMemberOnly = false;

        if (session && session.user) {
            const user = session.user;
            if (user.sysadmin || user.boardMember) {
                canSeeMemberOnly = true;
            } else {
                canSeeMemberOnly = await isActiveMember(user.id);
            }
        }

        const andClauses: Record<string, unknown>[] = [];

        if (activeOnly) {
            andClauses.push({
                OR: [
                    { end: null },
                    { end: { gte: new Date() } }
                ]
            });
        }

        if (!canSeeMemberOnly) {
            andClauses.push({ memberOnly: false });
        }

        let canSeeDrafts = false;
        let userId: number | undefined;
        if (session && session.user) {
            userId = session.user.id;
            if (session.user.sysadmin || session.user.boardMember) {
                canSeeDrafts = true;
            }
        }

        if (!canSeeDrafts) {
            if (userId && !isNaN(userId)) {
                andClauses.push({
                    OR: [
                        { phase: { not: 'PLANNING' } },
                        { leadMentorId: userId }
                    ]
                });
            } else {
                andClauses.push({ phase: { not: 'PLANNING' } });
            }
        }

        const programs = await prisma.program.findMany({
            where: andClauses.length > 0 ? { AND: andClauses } : undefined,
            orderBy: { begin: 'asc' },
            include: {
                _count: {
                    select: {
                        participants: true,
                        volunteers: true,
                        events: true
                    }
                }
            }
        });

        return NextResponse.json(programs);
    } catch (error) {
        await logBackendError(error, "GET /api/programs");
        return NextResponse.json({ error: "Failed to fetch programs" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    const canCreate = session?.user?.sysadmin || session?.user?.boardMember;

    if (!session || !canCreate) {
        return NextResponse.json({ error: "Forbidden: Only Admin or Board Members can create programs" }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { name, leadMentorId, begin, end, memberOnly, minAge, maxAge, memberPrice, nonMemberPrice, maxParticipants } = body;

        if (!name) {
            return NextResponse.json({ error: "Program name is required" }, { status: 400 });
        }

        if (!leadMentorId) {
            return NextResponse.json({ error: "Lead Mentor is required" }, { status: 400 });
        }

        // Client sends a raw dollar string; tolerate a number too. Convert to cents here.
        const mPrice = dollarsToCentsOrNull(memberPrice != null ? String(memberPrice) : undefined);
        const nmPrice = dollarsToCentsOrNull(nonMemberPrice != null ? String(nonMemberPrice) : undefined);
        const maxPart = maxParticipants ? parseInt(maxParticipants, 10) : null;

        // Try to create Shopify entities
        let shopifyData: { shopifyProductId: string, shopifyMemberVariantId: string | null, shopifyNonMemberVariantId: string | null } | null = null;
        
        // Only try to create if at least one price is provided. Otherwise it's a free program.
        if ((mPrice && mPrice > 0) || (nmPrice && nmPrice > 0)) {
            shopifyData = await createShopifyProgramVariants(name, mPrice, nmPrice, maxPart);
        }

        const newProgram = await prisma.program.create({
            data: {
                name,
                leadMentorId: parseInt(leadMentorId, 10),
                begin: begin ? new Date(begin) : null,
                end: end ? new Date(end) : null,
                memberOnly: memberOnly || false,
                minAge: minAge || null,
                maxAge: maxAge || null,
                memberPrice: mPrice,
                nonMemberPrice: nmPrice,
                maxParticipants: maxPart,
                shopifyProductId: shopifyData?.shopifyProductId || null,
                shopifyMemberVariantId: shopifyData?.shopifyMemberVariantId || null,
                shopifyNonMemberVariantId: shopifyData?.shopifyNonMemberVariantId || null,
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: session.user.id,
                action: 'CREATE',
                tableName: 'Program',
                affectedEntityId: newProgram.id,
                newData: JSON.stringify(newProgram)
            }
        });

        if (newProgram.leadMentorId) {
            await sendNotification(newProgram.leadMentorId, 'PROGRAM_ASSIGNMENT', { programName: newProgram.name });
        }

        const responseObj: Record<string, unknown> = { success: true, program: newProgram };
        if (((mPrice && mPrice > 0) || (nmPrice && nmPrice > 0)) && !shopifyData) {
            responseObj.warning = "Program created, but Shopify integration failed or is not configured. Payment links will not work.";
        }

        return NextResponse.json(responseObj);
    } catch (error: unknown) {
        await logBackendError(error, "POST /api/programs");
        return NextResponse.json({ error: "Failed to create program" }, { status: 500 });
    }
}
