import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

// Registry-governed (GET /api/system-status/unsynced-scans): admission anyRole
// sysadmin/board; envelope 'scans'.
//
// The review queue from KIOSK_RESILIENCE §2 D7: RawBadgeLog rows a replay
// PARKED instead of toggling (reviewReason set by /api/scan — stale_replay,
// out_of_order, force_close_review) and that nobody has dismissed yet. #1667
// and #1669 shipped the code that creates these rows; this is the first
// surface that shows them.
//
// The select is the whole minimization story: person is narrowed to id + name,
// both public-tier, so no email or phone is in the bag at all and the registry
// grant carries no pii leg to strip one with.
export const GET = handler('GET /api/system-status/unsynced-scans', async () => {
    const scans = await prisma.rawBadgeLog.findMany({
        where: { reviewReason: { not: null }, reviewedAt: null },
        select: {
            id: true,
            personId: true,
            timestamp: true,
            location: true,
            clientEventId: true,
            reviewReason: true,
            person: { select: { id: true, name: true } },
        },
        orderBy: { timestamp: "desc" },
        take: 100,
    });
    return { RawBadgeLog: scans };
});
