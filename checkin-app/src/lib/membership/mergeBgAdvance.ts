import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";
import { fromWhere } from "@/lib/membership/lifecycle";
import { advanceExternalIfComplete } from "@/lib/membership/external";
import { householdBgIsFresh, nextBoundary } from "@/lib/membership/renewal";
import { applyVolunteerStatus, clearBackgroundCheck, notifyClearanceOutcome } from "@/lib/membership/review";

/**
 * A participant merge moves the newer of the two `lastBackgroundCheck` dates onto
 * the survivor, which can make a household covered while its in-flight application
 * is still parked waiting on a check. This runs when the merge is what flipped the
 * household to covered, and advances what it now covers.
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
 * The from-states the carryover acts on. One list, so the note-held audit covers
 * exactly the rows the stamps below would otherwise have touched.
 */
const CARRYOVER_STATES = ["PENDING_EXTERNAL_ACTION", "PENDING_PAYMENT", "PENDING_BG_REVIEW"] as const;

/** `householdBgIsFresh` against live board settings. Callers need the answer, not the settings row. */
export async function householdBgFresh(householdId: number | null): Promise<boolean> {
    if (!householdId) return false;
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const boundary = settings?.orgMembershipYearBoundary ? nextBoundary(settings.orgMembershipYearBoundary, new Date()) : null;
    return householdBgIsFresh(householdId, boundary, settings?.bgRecheckMonths ?? 0);
}

/**
 * Re-evaluate background-check coverage for a merge survivor's household. Run
 * AFTER the merge transaction commits: the survivor's live leads are only final
 * then, and the predicate reads the root client.
 *
 * `wasFreshBeforeMerge` is the same predicate read before the transaction. The
 * question is "did THIS merge make the household covered?", not "is it covered?" —
 * an already-covered household is one whose parked rows are parked for a reason
 * this merge did not change (a board reset re-opens a review on a household whose
 * leads still hold a valid check), and stamping those ends a re-review with no way
 * back and attributes it to a person who carried nothing in.
 *
 * Never throws — the merge has already committed, so a failure here must not be
 * reported to the operator as a failed merge. It lands in the error log instead.
 */
export async function advanceHouseholdBgAfterMerge(
    householdId: number | null,
    actorId: number,
    mergedPersonId: number,
    wasFreshBeforeMerge: boolean,
): Promise<void> {
    if (!householdId || wasFreshBeforeMerge) return;
    const source = { via: "merge" as const, sourcePersonId: mergedPersonId };
    try {
        const household = await prisma.household.findUnique({ where: { id: householdId }, select: { intakeNotes: true } });
        if (!household) return;
        if (!(await householdBgFresh(householdId))) return;

        // An intake note is an unread disclosure a human owes the household (#900/#907).
        // Nothing automatic clears past one; record that the merge made the household
        // fresh so the trail explains why a covered application is still parked.
        // #1499 (approved, unmerged) reverses this rule in docs/rules/membership.md;
        // this gate comes out after that lands, not before.
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
 *
 * One transaction, FOR UPDATE first: the attestation count is read under the lock
 * because an `attest(APPROVE)` committing beside an unlocked read would be orphaned
 * on a row that just left the reviewer queue, and the stamp, its audit row and the
 * volunteer write must land together or not at all.
 */
async function stampBgCleared(process: Candidate, householdId: number, actorId: number, from: object, source: Provenance): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OrgMembershipProcess" WHERE id = ${process.id} FOR UPDATE`;
        // A review an eligible reviewer has already attested is theirs to finish; a
        // dedupe action does not complete a human's 2-of-N.
        if (await tx.backgroundCheckAttestation.count({ where: { processId: process.id } })) return false;
        const { count } = await tx.orgMembershipProcess.updateMany({
            where: { id: process.id, bgClearedAt: null, ...from },
            data: { bgClearedAt: new Date() },
        });
        if (count !== 1) return false;
        await tx.auditLog.create({
            data: {
                actorId,
                action: "EDIT",
                tableName: "OrgMembershipProcess",
                affectedEntityId: process.id,
                secondaryAffectedEntity: householdId,
                newData: { bgClearedAt: true, ...source, reason: "still-valid background check carried in by participant merge" },
            },
        });
        await applyVolunteerStatus(tx, process.orgMembershipId!, householdId, false);
        return true;
    });
}

/**
 * PENDING_EXTERNAL_ACTION whose agreement is ALREADY signed: that row has no event
 * left to fire the advance, so without this it strands with its gate met (the reason
 * `submitIntake` re-runs the advance after its own shortcut).
 *
 * Signed only. An unsigned row still has `markContractSigned` coming, and stamping
 * ahead of it flips `advanceExternalIfComplete`'s `holdForNote` to false for good —
 * a note added between now and signing would then skip PENDING_BG_REVIEW and
 * `notifyReviewers()`, reaching no reviewer at all.
 */
async function stampPendingExternal(householdId: number, actorId: number, source: Provenance): Promise<void> {
    const from = fromWhere("PENDING_EXTERNAL_ACTION");
    for (const process of await uncleared(householdId, from, { contractSignedAt: { not: null } })) {
        if (!(await stampBgCleared(process, householdId, actorId, from, source))) continue;
        await advanceExternalIfComplete(process.id);
    }
}

/**
 * PENDING_PAYMENT (parallel track): status is already correct, so the stamp IS the
 * work — it drops the row out of the reviewer queue and pre-decides `activate()`'s
 * ACTIVE-vs-PENDING_BG_CLEARANCE branch.
 */
async function stampParallelPayment(householdId: number, actorId: number, source: Provenance): Promise<void> {
    const from = fromWhere("PENDING_PAYMENT");
    for (const process of await uncleared(householdId, from)) {
        await stampBgCleared(process, householdId, actorId, from, source);
    }
}

/**
 * PENDING_BG_REVIEW with the note that held it now deleted: nothing re-advances
 * such a row on its own. Stamping `bgClearedAt` alone would strand it — that drops
 * it out of the reviewer queue while nothing but `clearBackgroundCheck` moves its
 * status, leaving no exit but archival — so run the real clearance, which stamps
 * and converges in one write. Zero attestations only, re-read under the same lock.
 */
async function clearHeldReview(householdId: number, actorId: number): Promise<void> {
    const from = fromWhere("PENDING_BG_REVIEW");
    for (const process of await uncleared(householdId, from)) {
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
 * The household is now covered but a live intake note keeps the carryover off it.
 * Leave the state alone and audit the fact on every row a stamp would have reached,
 * so the board can see why a fresh household is still parked.
 */
async function noteHeldDisclosure(householdId: number, actorId: number, source: Provenance): Promise<void> {
    for (const process of await uncleared(householdId, { status: { in: [...CARRYOVER_STATES] } })) {
        await prisma.auditLog.create({
            data: {
                actorId,
                action: "EDIT",
                tableName: "OrgMembershipProcess",
                affectedEntityId: process.id,
                secondaryAffectedEntity: householdId,
                newData: { bgClearedAt: false, ...source, reason: "merge made this household background-check fresh; a live intake note held the carryover" },
            },
        });
    }
}
