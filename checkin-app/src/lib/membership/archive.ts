import prisma from "@/lib/prisma";
import { ReviewError } from "@/lib/membership/review";

/**
 * Board disposal of an abandoned application. Stamp archivedAt/archivedById so the
 * process drops off the board applications list. Only non-ACTIVE (pending)
 * applications are disposable — an ACTIVE membership is never archivable
 * (wrong_phase → 409). Idempotent: archiving an already-archived process is a
 * no-op that returns its existing archivedAt.
 */
export async function archiveApplication(processId: number, actorId: number) {
    const process = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    if (process.status === "ACTIVE") throw new ReviewError("wrong_phase", "An active membership cannot be archived.");
    if (process.archivedAt) return { archivedAt: process.archivedAt }; // idempotent no-op

    const now = new Date();
    await prisma.$transaction([
        prisma.orgMembershipProcess.update({ where: { id: processId }, data: { archivedAt: now, archivedById: actorId } }),
        prisma.auditLog.create({
            data: {
                actorId: actorId || 0,
                action: "EDIT",
                tableName: "OrgMembershipProcess",
                affectedEntityId: processId,
                oldData: { status: process.status },
                newData: { archived: true },
            },
        }),
    ]);
    return { archivedAt: now };
}
