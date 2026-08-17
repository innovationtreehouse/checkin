import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createShopifySingleVariantProgram } from "@/lib/shopify";
import { isProgramCheckoutBroken } from "@/lib/programCheckout";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

// Repair path for a program that has a price but no Shopify variant — a state
// program-create (api/programs POST) can't reach but a later price edit
// (api/programs/[id] PATCH) can, since PATCH never mints variants. Mirrors the
// creation call so the dev/local mock branch (config.shopifyMockActive) works too.
export const POST = withAuth({ roles: ['isSysadmin', 'isBoardMember'] }, async (_req, auth, ctx: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await ctx.params;
    const programId = parseInt(id, 10);
    if (isNaN(programId)) return apiError("Invalid program ID", 400);

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) return apiError("Program not found", 404);
    if (!isProgramCheckoutBroken(program)) {
        return apiError("Program checkout is already configured (or the program is free).", 400);
    }

    try {
        const basePriceCents = program.nonOrgMemberPriceCents ?? program.orgMemberPriceCents ?? null;
        const shopifyData = basePriceCents
            ? await createShopifySingleVariantProgram(program.name, basePriceCents, program.maxParticipants)
            : null;
        const updateData = shopifyData
            ? { shopifyProductId: shopifyData.shopifyProductId, shopifyVariantId: shopifyData.shopifyVariantId }
            : null;

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
