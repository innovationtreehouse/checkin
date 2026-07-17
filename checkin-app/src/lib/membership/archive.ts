import { Prisma, type OrgMembershipProcessStatus } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { ReviewError } from "@/lib/membership/review";
import { normalizeAuditData } from "@/lib/auditPayload";

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

/**
 * Restorable in-flight statuses an archived application can return to — every
 * INITIAL/RENEWAL in-flight status plus BLOCKED (pre-existing semantics: a
 * blocked process is the board's to resolve, not archive away). ACTIVE and
 * ARCHIVED itself are never restore targets.
 */
const RESTORABLE_STATUSES = new Set<OrgMembershipProcessStatus>([
    "INTAKE",
    "PENDING_EXTERNAL_ACTION",
    "PENDING_BG_REVIEW",
    "PENDING_PAYMENT",
    "PENDING_BG_CLEARANCE",
    "PENDING_RENEWAL",
    "RENEWAL_PENDING_BG",
    "BLOCKED",
]);

/**
 * Board recovery of a wrongly-archived application. ARCHIVED collapses whatever
 * phase the process was in, so the AuditLog is the only record of it: this walks
 * the process's audit rows newest-first and takes the most recent one that
 * recorded the ARCHIVED transition — its oldData.status is the restore target.
 * Refuses (wrong_phase) if no such row exists, or its target isn't a status this
 * can still restore to. The partial unique indexes (membership_one_inflight_*)
 * are the backstop if a fresh in-flight process now occupies that slot for the
 * same membership — caught as P2002 and surfaced as wrong_phase, same shape as
 * every other conflict here.
 */
export async function unarchiveApplication(processId: number, actorId: number) {
    const process = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    if (process.status !== "ARCHIVED") throw new ReviewError("wrong_phase", "Only an archived application can be unarchived.");

    const auditRows = await prisma.auditLog.findMany({
        where: { tableName: "OrgMembershipProcess", affectedEntityId: processId },
        orderBy: { id: "desc" },
    });
    const archivedRow = auditRows.find((row) => (normalizeAuditData(row.newData) as { status?: string } | null)?.status === "ARCHIVED");
    const target = (normalizeAuditData(archivedRow?.oldData) as { status?: string } | null)?.status as OrgMembershipProcessStatus | undefined;
    if (!target || !RESTORABLE_STATUSES.has(target)) {
        throw new ReviewError("wrong_phase", "Cannot determine the state this application was archived from.");
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Conditional on still-ARCHIVED: two concurrent unarchives both pass the
            // pre-check, but only the winner's updateMany flips it (count === 1) — so
            // the audit row is written exactly once. Mirrors beginRenewal/markContractSigned.
            const { count } = await tx.orgMembershipProcess.updateMany({
                where: { id: processId, status: "ARCHIVED" },
                data: { status: target, stageEnteredAt: new Date() },
            });
            if (count !== 1) return;
            await tx.auditLog.create({
                data: {
                    actorId: actorId || 0,
                    action: "EDIT",
                    tableName: "OrgMembershipProcess",
                    affectedEntityId: processId,
                    oldData: { status: "ARCHIVED" },
                    newData: { status: target, unarchived: true },
                },
            });
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            throw new ReviewError("wrong_phase", "Another application is already in flight for this household — resolve it first.");
        }
        throw e;
    }
    return { status: target };
}
