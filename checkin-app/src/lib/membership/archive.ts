import prisma from "@/lib/prisma";
import { ReviewError } from "@/lib/membership/review";

/**
 * Board disposal of an abandoned application. Transitions the process to the
 * terminal ARCHIVED status so it drops off every "live application" read (board
 * list + applicant intake) with a single declarative status check — no parallel
 * flag. Only non-ACTIVE (pending) applications are disposable; an ACTIVE
 * membership is never archivable (wrong_phase → 409). Idempotent: archiving an
 * already-ARCHIVED process is a no-op. Who/when/from-phase are captured in the
 * AuditLog row.
 */
export async function archiveApplication(processId: number, actorId: number) {
    const process = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    if (process.status === "ACTIVE") throw new ReviewError("wrong_phase", "An active membership cannot be archived.");
    if (process.status === "ARCHIVED") return { status: "ARCHIVED" as const }; // idempotent no-op

    await prisma.$transaction([
        prisma.orgMembershipProcess.update({ where: { id: processId }, data: { status: "ARCHIVED", stageEnteredAt: new Date() } }),
        prisma.auditLog.create({
            data: {
                actorId: actorId || 0,
                action: "EDIT",
                tableName: "OrgMembershipProcess",
                affectedEntityId: processId,
                oldData: { status: process.status },
                newData: { status: "ARCHIVED" },
            },
        }),
    ]);
    return { status: "ARCHIVED" as const };
}
