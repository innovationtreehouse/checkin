import { NextResponse } from "next/server";
import { withCron } from "@/lib/cronAuth";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { logger, logIntegrationError } from "@/lib/logger";
import { reconcileProgramGroup } from "@/lib/program/groupSync";

/**
 * GET /api/cron/program-google-group-reconcile — the nightly self-heal for
 * program → Google Group membership. For every program with a group configured,
 * diffs the group's members against its current ACTIVE participants (add missing,
 * remove MEMBER-role extras — see reconcileProgramGroup). This is the backstop
 * for anything the best-effort event pushes dropped during a Google outage.
 *
 * One failing program is isolated (log + Link Status) so the rest still reconcile.
 * No-ops cleanly when the integration is unconfigured. Authorized by
 * `Authorization: Bearer $CRON_SECRET` (lib/cronAuth.ts).
 *
 * SCHEDULE IS AN INFRA FOLLOW-UP: this route exists but nothing invokes it until
 * a scheduler entry is added in the infra repo (mirror the other crons' wiring).
 * See docs/designs/PROGRAM_GOOGLE_GROUP_SYNC.md.
 */
export const GET = withCron(async () => {
    if (!config.googleGroupsConfigured()) {
        return NextResponse.json({ success: true, configured: false, programs: 0, added: 0, removed: 0, failed: 0 });
    }

    const programs = await prisma.program.findMany({
        where: { googleGroupEmail: { not: null } },
        select: { id: true, googleGroupEmail: true },
    });

    let added = 0;
    let removed = 0;
    let failed = 0;

    for (const program of programs) {
        try {
            const result = await reconcileProgramGroup(program);
            if ("added" in result) {
                added += result.added;
                removed += result.removed;
            }
        } catch (err) {
            failed++;
            logger.error(`[CRON] Google Group reconcile failed for program ${program.id} (${program.googleGroupEmail}):`, err);
            await logIntegrationError("google-groups", err, { operation: "reconcile", programId: program.id });
        }
    }

    return NextResponse.json({ success: true, configured: true, programs: programs.length, added, removed, failed });
});
