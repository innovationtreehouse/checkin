import { NextResponse } from "next/server";
import { withAuth, getOptionalSessionUser } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { createShopifyProgramVariants } from "@/lib/shopify";
import { logBackendError, logger } from "@/lib/logger";
import { isActiveOrgMember } from "@/lib/orgMembership";
import { dollarsToCentsOrNull } from "@inventory/money";
import { apiError } from "@/lib/api-response";

// GET is the PUBLIC program catalog — anonymous callers legitimately get the
// non-draft, non-memberOnly list (asserted by programsAPI.integration.test.ts),
// so it can't move to withAuth (which 401s anonymous). getOptionalSessionUser
// applies the shared denied-household gate: a denied member is locked out of
// the whole app, so it collapses to undefined (anonymous) — they see only the
// public list and never the memberOnly programs isActiveOrgMember would otherwise
// reveal (P0-C).
export async function GET(req: Request) {
    const user = await getOptionalSessionUser(req);

    try {
        const { searchParams } = new URL(req.url);
        const activeOnly = searchParams.get("active") === "true";

        // Determine if the user is allowed to see memberOnly programs
        let canSeeMemberOnly = false;

        if (user) {
            if (user.isSysadmin || user.isBoardMember) {
                canSeeMemberOnly = true;
            } else {
                canSeeMemberOnly = await isActiveOrgMember(user.id);
            }
        }

        const andClauses: Record<string, unknown>[] = [];

        if (activeOnly) {
            andClauses.push({
                OR: [
                    { endAt: null },
                    { endAt: { gte: new Date() } }
                ]
            });
        }

        if (!canSeeMemberOnly) {
            andClauses.push({ memberOnly: false });
        }

        let canSeeDrafts = false;
        let userId: number | undefined;
        if (user) {
            userId = user.id;
            if (user.isSysadmin || user.isBoardMember) {
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
            orderBy: { startAt: 'asc' },
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
        return apiError("Failed to fetch programs", 500);
    }
}

export const POST = withAuth({ roles: ['isSysadmin', 'isBoardMember'] }, async (req, auth) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);

    // Hoisted so the catch can name an orphaned Shopify product (created, but DB write failed) for manual cleanup.
    let shopifyData: { shopifyProductId: string, shopifyMemberVariantId: string | null, shopifyNonMemberVariantId: string | null } | null = null;

    try {
        const body = await req.json();
        const { name, leadMentorId, startAt, endAt, memberOnly, minAge, maxAge, memberPrice, nonMemberPrice, maxParticipants } = body;

        if (!name) {
            return apiError("Program name is required", 400);
        }

        if (!leadMentorId) {
            return apiError("Lead Mentor is required", 400);
        }

        // Client sends a raw dollar string; tolerate a number too. Convert to cents here.
        const mPrice = dollarsToCentsOrNull(memberPrice != null ? String(memberPrice) : undefined);
        const nmPrice = dollarsToCentsOrNull(nonMemberPrice != null ? String(nonMemberPrice) : undefined);
        const maxPart = maxParticipants ? parseInt(maxParticipants, 10) : null;

        // Try to create Shopify entities
        // Only try to create if at least one price is provided. Otherwise it's a free program.
        if ((mPrice && mPrice > 0) || (nmPrice && nmPrice > 0)) {
            shopifyData = await createShopifyProgramVariants(name, mPrice, nmPrice, maxPart);
        }

        const newProgram = await prisma.program.create({
            data: {
                name,
                leadMentorId: parseInt(leadMentorId, 10),
                startAt: startAt ? new Date(startAt) : null,
                endAt: endAt ? new Date(endAt) : null,
                memberOnly: memberOnly || false,
                minAge: minAge || null,
                maxAge: maxAge || null,
                memberPriceCents: mPrice,
                nonMemberPriceCents: nmPrice,
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
                newData: newProgram
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
        if (shopifyData?.shopifyProductId) {
            logger.error("[Shopify] Orphaned product after program DB write failed, manual cleanup needed:", shopifyData.shopifyProductId);
        }
        await logBackendError(error, "POST /api/programs");
        return apiError("Failed to create program", 500);
    }
});
