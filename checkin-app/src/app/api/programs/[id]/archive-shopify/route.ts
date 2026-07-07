import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { setProgramListingArchived } from "@/lib/shopify";

// Retire (archive) or restore (un-archive) a program's Shopify LISTING —
// board/sysadmin only, on the program-ops Shopify section. Body: { archived }.
// See docs/designs/SHOPIFY_LISTING_ARCHIVE.md. Distinct from archiving the
// PROGRAM itself (independent action; a future program-archive hook should
// chain here). The checkin-side stamp (Program.shopifyArchivedAt) is what gates
// every app-side checkout surface; the Shopify product status flip is the live
// store effect. On a Shopify failure we still stamp checkin and surface a
// warning — reconcile by retrying or setting the status in the Shopify admin.
export const POST = withAuth({ roles: ['isSysadmin', 'isBoardMember'] }, async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await ctx.params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) return apiError("Invalid program ID", 400);

        const body = await req.json().catch(() => ({}));
        const { archived } = body;
        if (typeof archived !== 'boolean') return apiError("archived must be a boolean", 400);

        const program = await prisma.program.findUnique({ where: { id: programId } });
        if (!program) return apiError("Program not found", 404);

        const hasListing = !!(program.shopifyProductId || program.shopifyVariantId || program.shopifyOrgMemberVariantId || program.shopifyNonOrgMemberVariantId);
        if (archived && !hasListing) {
            return apiError("This program has no Shopify listing to archive.", 400);
        }

        // Idempotent: already in the requested state → no Shopify call, no re-stamp.
        const isArchived = !!program.shopifyArchivedAt;
        if (isArchived === archived) {
            return NextResponse.json({ success: true, program });
        }

        // Act on Shopify first, then stamp checkin regardless of the result
        // (guidance: archive the checkin side anyway, surface a warning on failure).
        const shopifyOk = await setProgramListingArchived(program, archived);

        const updated = await prisma.program.update({
            where: { id: programId },
            data: { shopifyArchivedAt: archived ? new Date() : null },
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

        const responseObj: Record<string, unknown> = { success: true, program: updated };
        if (!shopifyOk) {
            responseObj.warning = `Program listing ${archived ? "archived" : "un-archived"} in checkin, but the Shopify product status update failed. The store may still show it ${archived ? "active" : "archived"} — retry, or set the status in Shopify (System Status > Link Status).`;
        }
        return NextResponse.json(responseObj);
    } catch (error) {
        logger.error("Program Shopify archive error:", error);
        return apiError("Failed to update Shopify listing archive state", 500);
    }
});
