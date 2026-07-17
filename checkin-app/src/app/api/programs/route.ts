import { NextResponse } from "next/server";
import { withAuth, getOptionalSessionUser } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { createShopifySingleVariantProgram } from "@/lib/shopify";
import { logBackendError, logger } from "@/lib/logger";
import { isActiveOrgMember } from "@/lib/orgMembership";
import { dollarsToCentsOrNull } from "@inventory/money";
import { apiError } from "@/lib/api-response";
import { staleWhileRevalidate } from "@/lib/staleCache";
import { validateProgramAgeBounds } from "@/lib/programAge";

// GET is the PUBLIC program catalog — anonymous callers legitimately get the
// non-draft, non-orgMemberOnly list (asserted by programsAPI.integration.test.ts),
// so it can't move to withAuth (which 401s anonymous). getOptionalSessionUser
// applies the shared denied-household gate: a denied member is locked out of
// the whole app, so it collapses to undefined (anonymous) — they see only the
// public list and never the orgMemberOnly programs isActiveOrgMember would otherwise
// reveal (P0-C).
export async function GET(req: Request) {
    const user = await getOptionalSessionUser(req);

    try {
        const { searchParams } = new URL(req.url);
        const activeOnly = searchParams.get("active") === "true";

        // Determine if the user is allowed to see orgMemberOnly programs
        let canSeeOrgMemberOnly = false;

        if (user) {
            if (user.isSysadmin || user.isBoardMember) {
                canSeeOrgMemberOnly = true;
            } else {
                canSeeOrgMemberOnly = await isActiveOrgMember(user.id);
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

        if (!canSeeOrgMemberOnly) {
            andClauses.push({ orgMemberOnly: false });
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

        const fetchPrograms = () => prisma.program.findMany({
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

        // ANONYMOUS-ONLY cache (lib/staleCache): the where-clause is identical for
        // every signed-out caller, so one entry serves them all — and a session
        // (draft/mentor visibility varies the payload) never touches it, which is
        // what makes the cache leak-proof by construction. During an Aurora resume
        // the public directory renders instantly from the last-good copy instead
        // of spinning into a 500; counts are at most one refresh stale.
        if (!userId && !canSeeDrafts) {
            const { value } = await staleWhileRevalidate("programs:public", 60_000, fetchPrograms);
            return NextResponse.json(value);
        }
        return NextResponse.json(await fetchPrograms());
    } catch (error) {
        await logBackendError(error, "GET /api/programs");
        return apiError("Failed to fetch programs", 500);
    }
}

export const POST = withAuth({ roles: ['isSysadmin', 'isBoardMember'] }, async (req, auth) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);

    // Hoisted so the catch can name an orphaned Shopify product (created, but DB write failed) for manual cleanup.
    let shopifyData: { shopifyProductId: string, shopifyVariantId: string } | null = null;

    try {
        const body = await req.json();
        const { name, leadMentorId, startAt, endAt, orgMemberOnly, minAge, maxAge, memberPrice, nonMemberPrice, maxParticipants } = body;

        if (!name) {
            return apiError("Program name is required", 400);
        }

        if (!leadMentorId) {
            return apiError("Lead Mentor is required", 400);
        }

        const maxPart = maxParticipants != null ? parseInt(maxParticipants, 10) : null;
        if (maxPart == null || isNaN(maxPart) || maxPart < 1) {
            return apiError("Max participants is required and must be at least 1", 400);
        }

        const ageErr = validateProgramAgeBounds(minAge, maxAge);
        if (ageErr) {
            return apiError(ageErr, 400);
        }

        // Client sends a raw dollar string; tolerate a number too. Convert to cents here.
        const mPrice = dollarsToCentsOrNull(memberPrice != null ? String(memberPrice) : undefined);
        const nmPrice = dollarsToCentsOrNull(nonMemberPrice != null ? String(nonMemberPrice) : undefined);

        // Single-pool model (product decision 2026-07-06): ONE Shopify variant,
        // priced at the base/non-member rate — replaces the two-variant model for
        // NEW program creation going forward (legacy programs keep working via
        // the columns createShopifyProgramVariants still writes; see
        // sync-shopify's repair route). ponytail: falls back to the member price
        // only when no non-member price is set (e.g. a members-only-priced
        // program with no listed non-member tier) — normally sells at the
        // non-member/base rate per the design.
        const basePriceCents = nmPrice ?? mPrice ?? null;
        if (basePriceCents && basePriceCents > 0) {
            shopifyData = await createShopifySingleVariantProgram(name, basePriceCents, maxPart);
        }

        const newProgram = await prisma.program.create({
            data: {
                name,
                leadMentorId: parseInt(leadMentorId, 10),
                startAt: startAt ? new Date(startAt) : null,
                endAt: endAt ? new Date(endAt) : null,
                orgMemberOnly: orgMemberOnly || false,
                minAge: minAge || null,
                maxAge: maxAge || null,
                orgMemberPriceCents: mPrice,
                nonOrgMemberPriceCents: nmPrice,
                maxParticipants: maxPart,
                shopifyProductId: shopifyData?.shopifyProductId || null,
                shopifyVariantId: shopifyData?.shopifyVariantId || null,
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
