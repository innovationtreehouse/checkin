import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";

export const dynamic = "force-dynamic";

/**
 * GET /api/trusted-adults/operational — approved trusted adults with the board's
 * shared note, for the people who act on them: keyholders (global) and program
 * leads (the households whose children are in their programs). Board/sysadmin see
 * all. The registry view strips familyContext (pii) + internal notes; this handler
 * additionally restricts WHICH rows are returned so existence isn't leaked.
 */
export const GET = handler("GET /api/trusted-adults/operational", async ({ auth }) => {
    if (auth.type !== "session") throw unauthorized();
    const u = auth.user;
    const privileged = u.sysadmin || u.boardMember || u.keyholder;

    const where: { reviews: { some: { status: "APPROVED" } }; householdId?: { in: number[] } } = {
        reviews: { some: { status: "APPROVED" } },
    };

    if (!privileged) {
        // Program leads: households of children enrolled in programs they lead or core-vol.
        const led = await prisma.program.findMany({
            where: { leadMentorId: u.id },
            select: { participants: { select: { participant: { select: { householdId: true } } } } },
        });
        const coreVol = await prisma.programVolunteer.findMany({
            where: { participantId: u.id, isCore: true },
            select: { program: { select: { participants: { select: { participant: { select: { householdId: true } } } } } } },
        });
        const households = new Set<number>();
        for (const p of led) for (const pp of p.participants) households.add(pp.participant.householdId);
        for (const v of coreVol) for (const pp of v.program.participants) households.add(pp.participant.householdId);
        if (households.size === 0) return { TrustedAdult: [] };
        where.householdId = { in: [...households] };
    }

    const trustedAdults = await prisma.trustedAdult.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            householdId: true,
            counterpartyName: true,
            counterpartyPhone: true,
            counterpartyEmail: true,
            household: { select: { id: true, name: true } },
            reviews: {
                where: { status: "APPROVED" },
                orderBy: { id: "desc" },
                take: 1,
                select: { id: true, householdId: true, status: true, sharedNote: true, reviewBy: true },
            },
        },
    });
    return { TrustedAdult: trustedAdults };
});
