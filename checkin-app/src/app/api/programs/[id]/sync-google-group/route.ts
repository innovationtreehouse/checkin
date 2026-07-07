import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { logIntegrationError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";
import { reconcileProgramGroup } from "@/lib/program/groupSync";

/**
 * POST /api/programs/[id]/sync-google-group — the board-only "Sync now" button on
 * program-ops. Runs the same full diff as the nightly reconcile for ONE program,
 * on demand. Unlike the best-effort event pushes, this surfaces a Google failure
 * to the caller (502, also logged to Link Status) so a manual sync gives feedback.
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (_req, auth, ctx: { params: Promise<{ id: string }> }) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    const { id } = await ctx.params;
    const programId = parseInt(id, 10);
    if (isNaN(programId)) return apiError("Invalid program ID", 400);

    const program = await prisma.program.findUnique({ where: { id: programId }, select: { id: true, googleGroupEmail: true } });
    if (!program) return apiError("Program not found", 404);
    if (!program.googleGroupEmail) return apiError("This program has no Google Group configured.", 400);
    if (!config.googleGroupsConfigured()) return apiError("Google Directory integration is not configured on this server.", 503);

    try {
        const result = await reconcileProgramGroup(program);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        await logIntegrationError("google-groups", error, { operation: "manual-sync", programId });
        return apiError("Google Group sync failed. Check System Status > Link Status.", 502);
    }
});
