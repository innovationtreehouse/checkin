// The single apply path for the Google Groups + Slack membership sync ledger
// (SyncState). Upserts the ledger row for a desired entry and attempts the
// external op immediately (best-effort, never throws to callers) — used by BOTH
// the PR2 inline hooks (add-only subset, not part of this PR) and the nightly
// reconcile (full diff, lib/sync/reconcile.ts). Spec §4.4, REVIEW ADDENDUM A2/A6.
//
// Person reads here (`prisma.person.findUnique({ where: { id } })`) are
// findUnique-by-id: the drift guard's own documented boundary excludes findUnique
// entirely (src/__tests__/livePersonDriftGuard.test.ts's header) because a
// single-row lookup by primary key can never leak a tombstone into a list or
// inflate a count. That's also the right semantics here: a removal/warning must
// still resolve a since-merged person's email to actually clean up their external
// access — the same "sweep must see tombstones" rule the guard documents, just
// satisfied by the excluded shape rather than an ALLOWLIST entry.

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logIntegrationError } from "@/lib/logger";
import { escapeHtml, baseEmailLayout } from "@/lib/email-templates/base";
import { getGoogleDirectoryClient } from "./googleGroups";
import { getSlackClient } from "./slack";
import type { DesiredEntry } from "./desired";
import type { SyncState, SyncTargetKind, Prisma } from "@/generated/prisma/client";

const SYSTEM_ACTOR = 0;
/** Slack warn-then-remove grace period (REVIEW ADDENDUM A2). */
export const SLACK_REMOVAL_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Outcome of an apply attempt. The spec sketches applyAdd/applyRemove as
 * `Promise<void>` (design-doc pseudocode); this PR returns a small result instead
 * — a deliberate, minimal deviation (see the implementation report) so the
 * reconcile can budget ops, count added/removed/failed for its summary, and honor
 * Slack's `retryAfterMs` 429 backoff (spec §5.1) without re-reading DB state after
 * every call. Every DB write the design specifies still happens exactly as spec'd;
 * this only adds a return value on top.
 */
export interface ApplyResult {
    ok: boolean;
    retryAfterMs?: number;
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

async function audit(
    actorId: number,
    action: "CREATE" | "DELETE",
    syncStateId: number,
    newData: Prisma.InputJsonObject,
): Promise<void> {
    await prisma.auditLog.create({
        data: { actorId, action, tableName: "SyncState", affectedEntityId: syncStateId, newData },
    });
}

function workspaceInviteEmail(programName: string, inviteUrl: string): string {
    return baseEmailLayout(`
        <h2>You're invited to the ${escapeHtml(programName)} Slack workspace</h2>
        <p>Join the workspace to get access to the <strong>${escapeHtml(programName)}</strong> channel:</p>
        <p><a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>
    `);
}

function slackRemovalWarningEmail(channelId: string, programName: string, removeDate: Date): string {
    return baseEmailLayout(`
        <h2>Your Slack access is ending</h2>
        <p>Your access to the #${escapeHtml(channelId)} Slack channel for
        <strong>${escapeHtml(programName)}</strong> ends on ${escapeHtml(removeDate.toDateString())} —
        this happens automatically when program enrollment ends.</p>
    `);
}

/**
 * Upsert the ledger row for a desired entry and attempt the external ADD
 * immediately (best-effort). Never throws.
 */
export async function applyAdd(entry: DesiredEntry, now: Date, actorId: number): Promise<ApplyResult> {
    const row = await prisma.syncState.upsert({
        where: syncStateUniqueWhere(entry),
        create: {
            personId: entry.personId,
            targetKind: entry.targetKind,
            targetRef: entry.targetRef,
            scope: entry.scope,
            desired: true,
            reasons: entry.reasons,
        },
        // Re-desiring clears a pending Slack removal warning (A2 point 3): re-enrollment
        // cancels the pending kick.
        update: { desired: true, reasons: entry.reasons, removalWarnedAt: null },
    });

    if (entry.targetKind === "google_group" || entry.targetKind === "newsletter") {
        const client = getGoogleDirectoryClient();
        if (!client) {
            // Integration off (unconfigured) — leave applied:false, nightly retries once configured.
            return { ok: false };
        }
        const result = await client.insertMember(entry.targetRef, entry.email);
        if (result.ok) {
            await prisma.syncState.update({ where: { id: row.id }, data: { applied: true, error: null, lastAttemptAt: now } });
            await audit(actorId, "CREATE", row.id, {
                op: "add", targetKind: entry.targetKind, targetRef: entry.targetRef, scope: entry.scope, result: "ok",
            });
            return { ok: true };
        }
        await prisma.syncState.update({ where: { id: row.id }, data: { applied: false, error: result.error, lastAttemptAt: now } });
        await logIntegrationError("group-slack-sync", result.error, {
            targetKind: entry.targetKind, targetRef: entry.targetRef, personId: entry.personId,
        });
        return { ok: false };
    }

    // slack_channel
    if (!entry.botTokenRef) {
        await prisma.syncState.update({ where: { id: row.id }, data: { applied: false, error: "no slack token", lastAttemptAt: now } });
        return { ok: false };
    }
    const auth = await prisma.programSlackAuth.findUnique({ where: { programId: entry.botTokenRef } });
    const client = getSlackClient(auth?.botToken ?? null);
    if (!client) {
        await prisma.syncState.update({ where: { id: row.id }, data: { applied: false, error: "no slack token", lastAttemptAt: now } });
        return { ok: false };
    }

    const lookup = await client.lookupByEmail(entry.email);
    if (!lookup.ok) {
        if (lookup.notFound) {
            // Invite-link gap (R5): the person isn't in the workspace yet. Email them the
            // workspace invite link once; channel add happens on a later run once they've
            // joined. Never resend.
            if (!row.inviteEmailedAt) {
                const program = await prisma.program.findUnique({
                    where: { id: entry.botTokenRef },
                    select: { name: true, slackWorkspaceInviteUrl: true },
                });
                if (program?.slackWorkspaceInviteUrl) {
                    await sendEmail(entry.email, `Join the ${program.name} Slack workspace`, workspaceInviteEmail(program.name, program.slackWorkspaceInviteUrl));
                    await prisma.syncState.update({ where: { id: row.id }, data: { applied: false, error: null, lastAttemptAt: now, inviteEmailedAt: now } });
                    return { ok: false };
                }
            }
            await prisma.syncState.update({ where: { id: row.id }, data: { applied: false, error: null, lastAttemptAt: now } });
            return { ok: false };
        }
        await prisma.syncState.update({ where: { id: row.id }, data: { applied: false, error: lookup.error ?? "slack lookup failed", lastAttemptAt: now } });
        return { ok: false };
    }

    const invite = await client.inviteToChannel(entry.targetRef, [lookup.userId]);
    if (invite.ok) {
        await prisma.syncState.update({ where: { id: row.id }, data: { applied: true, error: null, lastAttemptAt: now } });
        await audit(actorId, "CREATE", row.id, {
            op: "add", targetKind: entry.targetKind, targetRef: entry.targetRef, scope: entry.scope, result: "ok",
        });
        return { ok: true };
    }
    await prisma.syncState.update({ where: { id: row.id }, data: { applied: false, error: invite.error, lastAttemptAt: now } });
    await logIntegrationError("group-slack-sync", invite.error, {
        targetKind: entry.targetKind, targetRef: entry.targetRef, personId: entry.personId,
    });
    return { ok: false, retryAfterMs: invite.retryAfterMs };
}

/**
 * google_group ONLY — never newsletter (add-only, forever), never slack_channel
 * (warn-then-remove, see applySlackRemoval below). Removal is IMMEDIATE on
 * boundary, no warning (A2: the warning applies to Slack only). Tolerates 404.
 * After a successful remove, the row is KEPT with applied:false (A6) — not
 * deleted — so the status view + drift stay honest and a re-add is idempotent
 * (the @@unique upsert handles it).
 */
export async function applyRemove(row: SyncState, now: Date, actorId: number): Promise<ApplyResult> {
    if (row.targetKind !== "google_group") return { ok: false };
    const client = getGoogleDirectoryClient();
    if (!client) return { ok: false };

    const person = await prisma.person.findUnique({ where: { id: row.personId }, select: { email: true } });
    if (!person?.email) {
        await prisma.syncState.update({ where: { id: row.id }, data: { error: "no email to remove", lastAttemptAt: now } });
        return { ok: false };
    }

    const result = await client.removeMember(row.targetRef, person.email);
    if (result.ok) {
        await prisma.syncState.update({ where: { id: row.id }, data: { applied: false, error: null, lastAttemptAt: now } });
        await audit(actorId, "DELETE", row.id, {
            op: "remove", targetKind: row.targetKind, targetRef: row.targetRef, scope: row.scope, result: "ok",
        });
        return { ok: true };
    }
    await prisma.syncState.update({ where: { id: row.id }, data: { error: result.error, lastAttemptAt: now } });
    await logIntegrationError("group-slack-sync", result.error, {
        targetKind: row.targetKind, targetRef: row.targetRef, personId: row.personId,
    });
    return { ok: false };
}

/**
 * slack_channel ONLY — warn-then-remove (REVIEW ADDENDUM A2). Called by the
 * reconcile for rows that are `applied && !desired`:
 *   1. removalWarnedAt == null -> send the warning email, set removalWarnedAt = now.
 *      No kick yet.
 *   2. removalWarnedAt set AND now >= removalWarnedAt + 7 days -> conversations.kick;
 *      on ok -> applied:false, audit DELETE.
 *   3. Otherwise (still within the grace window) -> no-op.
 * Clearing removalWarnedAt when desired flips back true happens in applyAdd's
 * upsert (A2 point 3), not here.
 */
export async function applySlackRemoval(
    row: SyncState,
    now: Date,
    actorId: number,
): Promise<{ warned: boolean; removed: boolean }> {
    if (row.targetKind !== "slack_channel") return { warned: false, removed: false };

    const [, programIdStr] = row.scope.split(":");
    const programId = Number(programIdStr);

    if (!row.removalWarnedAt) {
        const person = await prisma.person.findUnique({ where: { id: row.personId }, select: { email: true } });
        const program = await prisma.program.findUnique({ where: { id: programId }, select: { name: true } });
        if (person?.email) {
            const removeDate = new Date(now.getTime() + SLACK_REMOVAL_WARNING_MS);
            await sendEmail(
                person.email,
                "Your Slack channel access is ending",
                slackRemovalWarningEmail(row.targetRef, program?.name ?? "your program", removeDate),
            );
        }
        await prisma.syncState.update({ where: { id: row.id }, data: { removalWarnedAt: now } });
        return { warned: true, removed: false };
    }

    if (now.getTime() < row.removalWarnedAt.getTime() + SLACK_REMOVAL_WARNING_MS) {
        return { warned: false, removed: false }; // still within the grace window
    }

    const auth = await prisma.programSlackAuth.findUnique({ where: { programId } });
    const client = getSlackClient(auth?.botToken ?? null);
    const person = await prisma.person.findUnique({ where: { id: row.personId }, select: { email: true } });
    if (!client || !person?.email) {
        await prisma.syncState.update({ where: { id: row.id }, data: { error: "cannot remove: missing slack token or email", lastAttemptAt: now } });
        return { warned: false, removed: false };
    }

    const lookup = await client.lookupByEmail(person.email);
    if (!lookup.ok) {
        await prisma.syncState.update({ where: { id: row.id }, data: { error: lookup.error ?? "slack lookup failed", lastAttemptAt: now } });
        return { warned: false, removed: false };
    }

    const result = await client.removeFromChannel(row.targetRef, lookup.userId);
    if (result.ok) {
        await prisma.syncState.update({ where: { id: row.id }, data: { applied: false, error: null, lastAttemptAt: now } });
        await audit(actorId, "DELETE", row.id, {
            op: "remove", targetKind: row.targetKind, targetRef: row.targetRef, scope: row.scope, result: "ok",
        });
        return { warned: false, removed: true };
    }
    await prisma.syncState.update({ where: { id: row.id }, data: { error: result.error, lastAttemptAt: now } });
    await logIntegrationError("group-slack-sync", result.error, {
        targetKind: row.targetKind, targetRef: row.targetRef, personId: row.personId,
    });
    return { warned: false, removed: false };
}

export { SYSTEM_ACTOR };
