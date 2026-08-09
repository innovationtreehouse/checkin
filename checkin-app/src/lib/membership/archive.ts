import { Prisma, type OrgMembershipProcessStatus } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { ReviewError } from "@/lib/membership/review";
import { ALL_STATUSES, fromWhere } from "@/lib/membership/lifecycle";
import { personActor } from "@/lib/auditActor";

/**
 * Board disposal of an abandoned application. Transitions the process to the
 * ARCHIVED resting status so it drops off every "live application" read (board
 * list + applicant intake) with a single declarative status check — no parallel
 * flag. Only non-ACTIVE (pending) applications are disposable; an ACTIVE
 * membership is never archivable (wrong_phase → 409). Idempotent: archiving an
 * already-ARCHIVED process is a no-op. The collapsed phase is captured on the row
 * itself (`archivedFromStatus`) as part of the same write; who/when go to AuditLog.
 */
export async function archiveApplication(processId: number, actorId: number) {
    const process = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    if (process.status === "ACTIVE") throw new ReviewError("wrong_phase", "An active membership cannot be archived.");
    if (process.status === "ARCHIVED") return { status: "ARCHIVED" as const }; // idempotent no-op

    await prisma.$transaction([
        prisma.orgMembershipProcess.update({
            where: { id: processId },
            data: { status: "ARCHIVED", archivedFromStatus: process.status, stageEnteredAt: new Date() },
        }),
        prisma.auditLog.create({
            data: {
                ...personActor(actorId),
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
 * Restore targets are the statuses `archiveApplication` can actually capture, derived
 * from its own gate above rather than from a second list. That gate is `status !== ACTIVE`
 * (ARCHIVED returns early), so the set is every other status — one wider than
 * ARCHIVABLE_STATUSES, which omits the legacy RENEWAL_PENDING_BG on the premise that
 * nothing is ever archived from it. Migration 20260806160000 backfills that very value.
 */
const RESTORABLE_STATUSES = new Set<OrgMembershipProcessStatus>(
    ALL_STATUSES.filter((s) => s !== "ACTIVE" && s !== "ARCHIVED"),
);

/**
 * Board recovery of a wrongly-archived application. The restore target is the
 * pre-image the archive write captured on the row (`archivedFromStatus`) — not a
 * reconstruction from the audit trail (principles.md §"Decisions are reversible").
 * Refuses (wrong_phase) if the column is unset, or holds a status this can no
 * longer restore to. The partial unique indexes (membership_one_inflight_*) are
 * the backstop if a fresh in-flight process now occupies that slot for the same
 * membership — caught as P2002 and surfaced as wrong_phase, same shape as every
 * other conflict here.
 */
export async function unarchiveApplication(processId: number, actorId: number) {
    const process = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    if (process.status !== "ARCHIVED") throw new ReviewError("wrong_phase", "Only an archived application can be unarchived.");

    const target = process.archivedFromStatus ?? undefined;
    if (!target || !RESTORABLE_STATUSES.has(target)) {
        throw new ReviewError("wrong_phase", "Cannot determine the state this application was archived from.");
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Conditional on still-ARCHIVED: two concurrent unarchives both pass the
            // pre-check, but only the winner's updateMany flips it (count === 1) — so
            // the audit row is written exactly once. Mirrors beginRenewal/markContractSigned.
            const { count } = await tx.orgMembershipProcess.updateMany({
                // #13 unarchive CAS from-state (ARCHIVED) from the definition (#1080).
                where: { id: processId, ...fromWhere("ARCHIVED") },
                data: { status: target, archivedFromStatus: null, stageEnteredAt: new Date() },
            });
            if (count !== 1) return;
            await tx.auditLog.create({
                data: {
                    ...personActor(actorId),
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
