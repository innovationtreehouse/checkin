import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";
import { fromWhere } from "@/lib/membership/lifecycle";
import { advanceExternalIfComplete } from "@/lib/membership/external";
import { householdBgIsFresh, nextBoundary } from "@/lib/membership/renewal";
import { applyVolunteerStatus, clearBackgroundCheck, notifyClearanceOutcome } from "@/lib/membership/review";

/**
 * A participant merge moves the newer of the two `lastBackgroundCheck` dates onto
 * the survivor and can promote them to household lead, which makes a household
 * covered while its in-flight application is still parked waiting on a check.
 * This re-runs the predicate intake and renewal use — no intake note AND
 * `householdBgIsFresh` — and advances what it now covers.
 *
 * Scope: household INITIAL/RENEWAL processes only. Every query goes through
 * `orgMembership`, which structurally excludes PERSON_BG and PERSON_AGREEMENT —
 * both carry `orgMembershipId: null`. `householdBgIsFresh` asks about household
 * LEADS, so answering it for an adult child's own PERSON_BG would clear their
 * check because a parent's is fresh.
 *
 * Advance only: it acts on rows whose `bgClearedAt` is null and never unstamps one.
 */

/** A process this carryover may act on. */
type Candidate = { id: number; orgMembershipId: number | null };

/**
 * Re-evaluate background-check coverage for a merge survivor's household. Run
 * AFTER the merge transaction commits: the survivor's live leads are only final
 * then, and the predicate reads the root client.
 *
 * Never throws — the merge has already committed, so a failure here must not be
 * reported to the operator as a failed merge. It lands in the error log instead.
 */
export async function advanceHouseholdBgAfterMerge(
    householdId: number | null,
    actorId: number,
    mergedPersonId: number,
): Promise<void> {
    if (!householdId) return;
    const source = { via: "merge" as const, sourcePersonId: mergedPersonId };
    try {
        const household = await prisma.household.findUnique({ where: { id: householdId }, select: { intakeNotes: true } });
        if (!household) return;
        const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        const boundary = settings?.orgMembershipYearBoundary ? nextBoundary(settings.orgMembershipYearBoundary, new Date()) : null;
        if (!(await householdBgIsFresh(householdId, boundary, settings?.bgRecheckMonths ?? 0))) return;

        // An intake note is an unread disclosure a human owes the household (#900/#907).
        // Nothing automatic clears past one; record that the merge made the household
        // fresh so the trail explains why a covered application is still parked.
        if (household.intakeNotes?.trim()) {
            await noteHeldDisclosure(householdId, actorId, source);
            return;
        }

        await stampPendingExternal(householdId, actorId, source);
        await stampParallelPayment(householdId, actorId, source);
        await clearHeldReview(householdId, actorId);
    } catch (error) {
        await logBackendError(error, "membership merge background-check advance", { householdId, mergedPersonId });
    }
}

type Provenance = { via: "merge"; sourcePersonId: number };

/** Household INITIAL/RENEWAL rows at `from` that still owe a background check. */
function uncleared(householdId: number, from: object, extra: object = {}): Promise<Candidate[]> {
    return prisma.orgMembershipProcess.findMany({
        where: { orgMembership: { householdId }, bgClearedAt: null, ...extra, ...from },
        select: { id: true, orgMembershipId: true },
    });
}

/**
 * Stamp `bgClearedAt` under a CAS on the from-state, and apply the volunteer
 * allowlist: the fresh-check shortcut means `clearBackgroundCheck` never runs this
 * cycle, and without it a pre-designated volunteer household gets non-volunteer
 * dues (#874). Returns false when the row moved on under us.
 */
async function stampBgCleared(process: Candidate, householdId: number, actorId: number, from: object, source: Provenance): Promise<boolean> {
    const { count } = await prisma.orgMembershipProcess.updateMany({
        where: { id: process.id, bgClearedAt: null, ...from },
        data: { bgClearedAt: new Date() },
    });
    if (count !== 1) return false;
    await prisma.auditLog.create({
        data: {
            actorId,
            action: "EDIT",
            tableName: "OrgMembershipProcess",
            affectedEntityId: process.id,
            secondaryAffectedEntity: householdId,
            newData: { bgClearedAt: true, ...source, reason: "still-valid background check carried in by participant merge" },
        },
    });
    await applyVolunteerStatus(prisma, process.orgMembershipId!, householdId, false);
    return true;
}

/**
 * PENDING_EXTERNAL_ACTION: the applicant's card now reads "no new background check
 * needed". `advanceExternalIfComplete` owns the status edge and no-ops until the
 * agreement is signed — but a row whose contract is ALREADY signed has no other
 * event left to fire it, so without this call it strands with its gate met (the
 * reason `submitIntake` re-runs the advance after its own shortcut).
 */
async function stampPendingExternal(householdId: number, actorId: number, source: Provenance): Promise<void> {
    const from = fromWhere("PENDING_EXTERNAL_ACTION");
    for (const process of await uncleared(householdId, from)) {
        if (!(await stampBgCleared(process, householdId, actorId, from, source))) continue;
        await advanceExternalIfComplete(process.id);
    }
}

/**
 * PENDING_PAYMENT (parallel track): status is already correct, so the stamp IS the
 * work — it drops the row out of the reviewer queue and pre-decides `activate()`'s
 * ACTIVE-vs-PENDING_BG_CLEARANCE branch. A row an eligible reviewer has already
 * attested is theirs to finish; the merge must not complete their review.
 */
async function stampParallelPayment(householdId: number, actorId: number, source: Provenance): Promise<void> {
    const from = fromWhere("PENDING_PAYMENT");
    for (const process of await uncleared(householdId, from, { attestations: { none: {} } })) {
        await stampBgCleared(process, householdId, actorId, from, source);
    }
}

/**
 * PENDING_BG_REVIEW with the note that held it now deleted: nothing re-advances
 * such a row on its own. Stamping `bgClearedAt` alone would strand it — that drops
 * it out of the reviewer queue while nothing but `clearBackgroundCheck` moves its
 * status, leaving no exit but archival — so run the real clearance, which stamps
 * and converges in one write. Zero attestations only, as above.
 */
async function clearHeldReview(householdId: number, actorId: number): Promise<void> {
    const from = fromWhere("PENDING_BG_REVIEW");
    for (const process of await uncleared(householdId, from, { attestations: { none: {} } })) {
        const outcome = await prisma.$transaction(async (tx) => {
            // clearBackgroundCheck's contract; also serializes against a concurrent attest.
            await tx.$queryRaw`SELECT id FROM "OrgMembershipProcess" WHERE id = ${process.id} FOR UPDATE`;
            const fresh = await tx.orgMembershipProcess.findUnique({
                where: { id: process.id },
                select: { status: true, bgClearedAt: true, _count: { select: { attestations: true } } },
            });
            if (!fresh || fresh.status !== "PENDING_BG_REVIEW" || fresh.bgClearedAt || fresh._count.attestations > 0) return null;
            return clearBackgroundCheck(tx, process.id, actorId);
        });
        if (outcome) await notifyClearanceOutcome(outcome);
    }
}

/**
 * The household is now covered but a live intake note keeps its held application
 * parked. Leave the state alone and audit the fact, so the board can see why a
 * fresh household is still in the review queue.
 */
async function noteHeldDisclosure(householdId: number, actorId: number, source: Provenance): Promise<void> {
    for (const process of await uncleared(householdId, fromWhere("PENDING_BG_REVIEW"))) {
        await prisma.auditLog.create({
            data: {
                actorId,
                action: "EDIT",
                tableName: "OrgMembershipProcess",
                affectedEntityId: process.id,
                secondaryAffectedEntity: householdId,
                newData: { bgClearedAt: false, ...source, reason: "merge made this household background-check fresh; intake note still held for review" },
            },
        });
    }
}
