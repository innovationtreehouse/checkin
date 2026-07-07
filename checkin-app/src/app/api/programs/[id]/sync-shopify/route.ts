import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createShopifyProgramVariants, createShopifySingleVariantProgram } from "@/lib/shopify";
import { isProgramCheckoutBroken } from "@/lib/programCheckout";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

// Repair path for a program that has a price but no Shopify variant — a state
// program-create (api/programs POST) can't reach but a later price edit
// (api/programs/[id] PATCH) can, since PATCH never mints variants. Mirrors the
// creation call so the dev/local mock branch (config.shopifyMockActive) works too.
//
// Single-pool transition: a program already carrying ONE of the legacy
// org/non-org variant ids is mid-flight on the OLD model (or was created
// before the single-pool switch) — repair it the same way (both legacy
// columns, keeping the matching one). A program with NEITHER legacy column set
// is either new or never got that far — repair it onto the single-pool model
// instead, writing shopifyVariantId.
//
// ponytail: the legacy branch recreates the whole product+variants and
// overwrites all IDs. For the common prod case (made free, then priced → no
// product at all) that's exactly right. For the rarer partial case (one
// variant exists, the other tier was added later) it orphans the old product.
// Upgrade to patching only the missing variant onto the existing product if
// partial repair ever matters.
export const POST = withAuth({ roles: ['isSysadmin', 'isBoardMember'] }, async (_req, auth, ctx: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await ctx.params;
    const programId = parseInt(id, 10);
    if (isNaN(programId)) return apiError("Invalid program ID", 400);

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) return apiError("Program not found", 404);
    // Archived listing (SHOPIFY_LISTING_ARCHIVE.md): never re-mint a live listing
    // for a retired program — un-archive it first.
    if (program.shopifyArchivedAt) {
        return apiError("This program's Shopify listing is archived. Un-archive it before syncing checkout.", 400);
    }
    if (!isProgramCheckoutBroken(program)) {
        return apiError("Program checkout is already configured (or the program is free).", 400);
    }

    try {
        const isLegacy = !!(program.shopifyOrgMemberVariantId || program.shopifyNonOrgMemberVariantId);

        let updateData: { shopifyProductId: string; shopifyOrgMemberVariantId: string | null; shopifyNonOrgMemberVariantId: string | null }
            | { shopifyProductId: string; shopifyVariantId: string }
            | null = null;

        if (isLegacy) {
            const shopifyData = await createShopifyProgramVariants(
                program.name,
                program.orgMemberPriceCents,
                program.nonOrgMemberPriceCents,
                program.maxParticipants,
            );
            if (shopifyData) {
                updateData = {
                    shopifyProductId: shopifyData.shopifyProductId,
                    shopifyOrgMemberVariantId: shopifyData.shopifyOrgMemberVariantId,
                    shopifyNonOrgMemberVariantId: shopifyData.shopifyNonOrgMemberVariantId,
                };
            }
        } else {
            const basePriceCents = program.nonOrgMemberPriceCents ?? program.orgMemberPriceCents ?? null;
            const shopifyData = basePriceCents
                ? await createShopifySingleVariantProgram(program.name, basePriceCents, program.maxParticipants)
                : null;
            if (shopifyData) {
                updateData = { shopifyProductId: shopifyData.shopifyProductId, shopifyVariantId: shopifyData.shopifyVariantId };
            }
        }

        if (!updateData) {
            return apiError("Shopify sync failed or is not configured. Check Shopify credentials.", 502);
        }

        const updated = await prisma.program.update({
            where: { id: programId },
            data: updateData,
        });

        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: 'EDIT',
                tableName: 'Program',
                affectedEntityId: updated.id,
                oldData: program,
                newData: updated,
            },
        });

        return NextResponse.json({ success: true, program: updated });
    } catch (error) {
        await logBackendError(error, "POST /api/programs/[id]/sync-shopify");
        return apiError("Failed to sync program to Shopify", 500);
    }
});
