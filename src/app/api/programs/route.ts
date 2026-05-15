import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { createShopifyProgramVariants } from "@/lib/shopify";
import { logBackendError } from "@/lib/logger";
import { ApiResponseError, handler, badRequest, forbidden, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/programs', async ({ req, auth }) => {
    try {
        const { searchParams } = new URL(req.url);
        const activeOnly = searchParams.get("active") === "true";

        let canSeeMemberOnly = false;

        if (auth.type === 'session') {
            const user = auth.user;
            if (user.sysadmin || user.boardMember) {
                canSeeMemberOnly = true;
            } else {
                const participant = await prisma.participant.findUnique({
                    where: { id: user.id },
                    include: {
                        memberships: {
                            where: { active: true }
                        }
                    }
                });
                if (participant && participant.memberships.length > 0) {
                    canSeeMemberOnly = true;
                }
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
        if (auth.type === 'session') {
            userId = auth.user.id;
            if (auth.user.sysadmin || auth.user.boardMember) {
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

        return { Program: programs };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "GET /api/programs");
        throw err;
    }
});

export const POST = handler('POST /api/programs', async ({ req, auth }) => {
    try {
        if (auth.type !== 'session') throw unauthorized();
        const canCreate = auth.user.sysadmin || auth.user.boardMember;
        if (!canCreate) throw forbidden("Forbidden: Only Admin or Board Members can create programs");

        const body = await req.json();
        const { name, leadMentorId, begin, end, memberOnly, minAge, maxAge, memberPrice, nonMemberPrice, maxParticipants } = body;

        if (!name) {
            throw badRequest("Program name is required");
        }

        if (!leadMentorId) {
            throw badRequest("Lead Mentor is required");
        }

        const mPrice = memberPrice ? parseInt(memberPrice, 10) : null;
        const nmPrice = nonMemberPrice ? parseInt(nonMemberPrice, 10) : null;
        const maxPart = maxParticipants ? parseInt(maxParticipants, 10) : null;

        let shopifyData: { shopifyProductId: string, shopifyMemberVariantId: string | null, shopifyNonMemberVariantId: string | null } | null = null;

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
                actorId: auth.user.id,
                action: 'CREATE',
                tableName: 'Program',
                affectedEntityId: newProgram.id,
                newData: JSON.stringify(newProgram)
            }
        });

        if (newProgram.leadMentorId) {
            await sendNotification(newProgram.leadMentorId, 'PROGRAM_ASSIGNMENT', { programName: newProgram.name });
        }

        return { Program: newProgram };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "POST /api/programs");
        throw err;
    }
});
