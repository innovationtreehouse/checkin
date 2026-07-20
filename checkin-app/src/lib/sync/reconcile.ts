// Nightly reconcile for the Google Groups + Slack membership sync — the authority
// and backstop of the two-trigger design (spec §0/§5.1). Computes desired-vs-applied
// off the SyncState ledger and applies adds/removals/retries, budgeted so a woken
// scale-to-zero task finishes fast (unbudgeted rows are `deferred`, picked up next
// run — the ledger is resumable, no state lost).
//
// This module reads `SyncState` for the diff (not `Person` directly) — see spec §8:
// "prefer keeping person reads inside desired.ts (which filters LIVE_PERSON) and
// having reconcile read only SyncState." The one exception, resolving a person's
// email for a Slack removal-warning email, lives in apply.ts's applySlackRemoval
// via a findUnique-by-id (excluded from the drift guard by shape — see apply.ts's
// header comment), so this file has no Person-query site of its own and needs no
// drift-guard allowlist entry.
//
// PR2 wires this into the nightly cron (src/app/api/cron/nightly/route.ts) — this
// PR ships the function with no caller.

import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { computeDesiredState, type DesiredEntry } from "./desired";
import { applyAdd, applyRemove, applySlackRemoval, SYSTEM_ACTOR } from "./apply";
import type { SyncState, SyncTargetKind } from "@/generated/prisma/client";

export interface ReconcileSummary {
    desired: number;
    added: number;
    removed: number;
    invitesEmailed: number;
    retried: number;
    failed: number;
    googleOff: boolean;
    deferred: number;
}

/** Per-run cap on external-API-touching operations, so a woken scale-to-zero task
 *  finishes fast. Unbudgeted rows are deferred to the next run. */
const MAX_OPS = 200;

function keyOf(e: { personId: number; targetKind: SyncTargetKind; targetRef: string; scope: string }): string {
    return `${e.personId}|${e.targetKind}|${e.targetRef}|${e.scope}`;
}

function syncStateUniqueWhere(e: { personId: number; targetKind: SyncTargetKind; targetRef: string; scope: string }) {
    return {
        personId_targetKind_targetRef_scope: {
            personId: e.personId,
            targetKind: e.targetKind,
            targetRef: e.targetRef,
            scope: e.scope,
        },
    } as const;
}

/** Step 2: upsert every desired entry's ledger row (desired:true, reasons). Also
 *  clears a pending Slack removal warning (A2 point 3) — re-enrollment cancels it. */
async function upsertDesired(desired: DesiredEntry[]): Promise<void> {
    for (const entry of desired) {
        await prisma.syncState.upsert({
            where: syncStateUniqueWhere(entry),
            create: {
                personId: entry.personId,
                targetKind: entry.targetKind,
                targetRef: entry.targetRef,
                scope: entry.scope,
                desired: true,
                reasons: entry.reasons,
            },
            update: { desired: true, reasons: entry.reasons, removalWarnedAt: null },
        });
    }
}

/** Step 3: any EXISTING desired:true row not in today's desired set flips to
 *  desired:false — except newsletter, which is never removed (spec §5.3). */
async function undesireLapsed(desiredKeys: Set<string>): Promise<void> {
    const existingDesired = await prisma.syncState.findMany({
        where: { desired: true, targetKind: { not: "newsletter" } },
        select: { id: true, personId: true, targetKind: true, targetRef: true, scope: true },
    });
    const lapsedIds = existingDesired.filter((r) => !desiredKeys.has(keyOf(r))).map((r) => r.id);
    if (lapsedIds.length > 0) {
        await prisma.syncState.updateMany({ where: { id: { in: lapsedIds } }, data: { desired: false } });
    }
}

export async function runGroupSlackReconcile(now = new Date()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
        desired: 0, added: 0, removed: 0, invitesEmailed: 0, retried: 0, failed: 0,
        googleOff: !config.googleDirectoryConfigured(), deferred: 0,
    };

    // 1. Compute live desired state.
    const desired = await computeDesiredState(now);
    summary.desired = desired.length;
    const desiredKeys = new Set(desired.map(keyOf));

    // 2 + 3. Upsert desired rows, lapse the rest (except newsletter).
    await upsertDesired(desired);
    await undesireLapsed(desiredKeys);

    // 4. Diff and apply, budgeted.
    const allRows = await prisma.syncState.findMany();
    const rowByKey = new Map(allRows.map((r) => [keyOf(r), r]));

    let opsUsed = 0;
    let slackRateLimited = false;

    // Adds (includes retries of previously-failed adds — they're just applied:false rows).
    for (const entry of desired) {
        const row = rowByKey.get(keyOf(entry));
        if (!row || row.applied) continue;
        if (opsUsed >= MAX_OPS) { summary.deferred++; continue; }
        if (entry.targetKind === "slack_channel" && slackRateLimited) { summary.deferred++; continue; }

        const wasRetry = !!row.lastAttemptAt;
        const hadInviteAlready = !!row.inviteEmailedAt;
        opsUsed++;
        const result = await applyAdd(entry, now, SYSTEM_ACTOR);
        if (result.ok) summary.added++; else summary.failed++;
        if (wasRetry) summary.retried++;
        if (result.retryAfterMs !== undefined) slackRateLimited = true;

        if (entry.targetKind === "slack_channel" && !hadInviteAlready) {
            const after = await prisma.syncState.findUnique({
                where: syncStateUniqueWhere(entry),
                select: { inviteEmailedAt: true },
            });
            if (after?.inviteEmailedAt) summary.invitesEmailed++;
        }
    }

    // Removals: google_group is immediate; slack_channel is warn-then-remove (A2).
    // Newsletter never reaches here (step 3 never un-desires it).
    for (const row of allRows) {
        if (row.desired || !row.applied) continue;
        if (opsUsed >= MAX_OPS) { summary.deferred++; continue; }

        if (row.targetKind === "google_group") {
            opsUsed++;
            const result = await applyRemove(row as SyncState, now, SYSTEM_ACTOR);
            if (result.ok) summary.removed++; else summary.failed++;
        } else if (row.targetKind === "slack_channel") {
            opsUsed++;
            const result = await applySlackRemoval(row as SyncState, now, SYSTEM_ACTOR);
            if (result.removed) summary.removed++;
        }
    }

    return summary;
}
