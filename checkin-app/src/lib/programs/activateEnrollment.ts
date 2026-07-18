import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { adjustProgramInventory } from "@/lib/shopify";
import { fromWhere } from "@/lib/programs/enrollmentState";

/**
 * Activate paid program enrollments — the single choke point the Shopify
 * orders/paid webhook AND the reconciler both call (mirrors membership's
 * activate()). Extracted from the webhook route so a MISSED webhook can be
 * recovered by the reconciler through the exact same, idempotent path.
 *
 * Per participant: a transactionally-guarded PENDING → ACTIVE flip (so a webhook
 * redelivery or a reconciler re-run can't double-activate or double-count),
 * clearing the pending timer, stamping the paying order id, and releasing any
 * scholarship inventory hold (compensating Shopify's sale-time auto-decrement).
 *
 * The membership-item / tier check lives with the CALLER, because only the webhook
 * has the order's line-item variant ids — the mirror does not. The webhook passes
 * the computed values; the reconciler passes hasProgramItem=true (it matched the
 * order to a pending enrollment by email) and purchasedTier=null (tier unknown), in
 * which case the legacy two-pool sibling-inventory mirror is skipped.
 */
export interface ActivateEnrollmentInput {
    programId: number;
    /** Person ids to activate (all must belong to this program's pending set). */
    personIds: number[];
    /** Numeric Shopify order id, stored on each activated participant for reversal joins. */
    shopifyOrderId: string;
    /** Did the paid order contain this program's product? Fail-closed: false = don't activate. */
    hasProgramItem: boolean;
    /**
     * Which tier Shopify sold (true = org-member variant), for the legacy two-pool
     * sibling-inventory mirror. null = unknown (reconciler path) → skip the mirror.
     */
    purchasedOrgMember: boolean | null;
}

export interface ActivateEnrollmentResult {
    activatedCount: number;
    releasedHoldCount: number;
}

export async function activateProgramEnrollment(input: ActivateEnrollmentInput): Promise<ActivateEnrollmentResult> {
    const { programId, personIds, shopifyOrderId, hasProgramItem, purchasedOrgMember } = input;
    const program = await prisma.program.findUnique({ where: { id: programId } });

    let activatedCount = 0;
    let releasedHoldCount = 0;

    for (const personId of personIds) {
        const existing = await prisma.programParticipant.findUnique({ where: { programId_personId: { programId, personId } } });
        if (!existing) {
            logger.warn(`[enroll] Participant ${personId} not found in program ${programId} — ignoring payment.`);
            continue;
        }
        if (!hasProgramItem) {
            logger.warn(`[enroll] Order ${shopifyOrderId || "?"} for participant ${personId} / program ${programId} did not contain the program's Shopify variant — left PENDING, NOT activated.`);
            continue;
        }

        // Guarded PENDING → ACTIVE so a redelivery / re-run can't inflate the count.
        const activated = await prisma.programParticipant.updateMany({
            // T4 activate CAS from-state (any PENDING; sourced from the definition, #1080).
            where: { programId, personId, ...fromWhere("PENDING_UNPAID") },
            data: { status: "ACTIVE", pendingSince: null, shopifyOrderId },
        });
        activatedCount += activated.count;
        if (activated.count > 0) logger.info(`[enroll] Marked participant ${personId} ACTIVE for program ${programId}`);

        // Release a scholarship hold if one was set (compensates the sale's auto-decrement),
        // guarded (NOT NULL → NULL) so a retry can't release twice.
        if (existing.inventoryHeldAt) {
            const release = await prisma.programParticipant.updateMany({
                where: { programId, personId, inventoryHeldAt: { not: null } },
                data: { inventoryHeldAt: null },
            });
            releasedHoldCount += release.count;
        }
    }

    // Compensating +1 for every hold released, in one call. Never fatal.
    if (releasedHoldCount > 0) {
        const ok = await adjustProgramInventory(
            {
                shopifyVariantId: program?.shopifyVariantId ?? null,
                shopifyOrgMemberVariantId: program?.shopifyOrgMemberVariantId ?? null,
                shopifyNonOrgMemberVariantId: program?.shopifyNonOrgMemberVariantId ?? null,
            },
            releasedHoldCount,
        );
        if (!ok) logger.error(`[enroll] Failed to release ${releasedHoldCount} scholarship hold(s) for program ${programId} — capacity may be out of sync.`);
    }

    // LEGACY two-pool sibling mirror: only when we know the tier. Single-pool programs
    // (shopifyVariantId) need no mirror; the reconciler (tier unknown) skips it.
    if (activatedCount > 0 && !program?.shopifyVariantId && purchasedOrgMember !== null) {
        const siblingOnly = purchasedOrgMember
            ? { shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: program?.shopifyNonOrgMemberVariantId ?? null }
            : { shopifyOrgMemberVariantId: program?.shopifyOrgMemberVariantId ?? null, shopifyNonOrgMemberVariantId: null };
        const ok = await adjustProgramInventory({ shopifyVariantId: null, ...siblingOnly }, -activatedCount);
        if (!ok) logger.error(`[enroll] Failed to mirror sibling-variant inventory for program ${programId} — pools may be out of sync.`);
    }

    return { activatedCount, releasedHoldCount };
}
