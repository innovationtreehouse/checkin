import prisma from "@/lib/prisma";
import { handler, badRequest, notFound, unauthorized } from "@/security/handler";

// Registry-governed (POST /api/system-status/unsynced-scans/[id]): admission
// anyRole sysadmin/board; envelope null. `[id]` is a RawBadgeLog id.
//
// Dismiss — "I looked, nothing to do." It stamps the two review columns and
// touches nothing else: no Visit is minted here (KIOSK_RESILIENCE §5.26/B4 is
// still open on what a resolver may write, so the panel's other action deep-
// links to the manual-visit tool instead), and reviewReason is left intact so
// the row keeps saying why it parked.
//
// The where clause carries the whole guard: only a row that is actually PARKED
// and NOT yet reviewed can be stamped, so a dismiss cannot invent a review on
// an ordinary scan, and a double-click 404s rather than re-stamping a different
// actor over the first reviewer.
export const POST = handler<{ id: string }>(
    'POST /api/system-status/unsynced-scans/[id]',
    async ({ auth, params }) => {
        if (auth.type !== 'session') throw unauthorized();

        const id = Number(params.id);
        if (!Number.isInteger(id)) throw badRequest("Invalid scan id");

        const { count } = await prisma.rawBadgeLog.updateMany({
            where: { id, reviewReason: { not: null }, reviewedAt: null },
            data: { reviewedAt: new Date(), reviewedBy: auth.user.id },
        });
        if (count === 0) throw notFound("No scan awaiting review with that id.");

        // Empty bag — a dismissal ships no model data, so the registry declares
        // `envelope: null` and the 200 body is `{}`.
        return {};
    },
);
