// Shared service that keeps a program's Google Group membership in step with its
// active participants. This is the ONE place that maps program/person → the set
// of emails, so the event pushes and the nightly/manual reconcile all agree on
// "who should be in the group". Recipient rule mirrors notifications exactly:
// the participant's own email + every household lead (see resolveGroupEmails).
// See docs/designs/PROGRAM_GOOGLE_GROUP_SYNC.md.

import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { logger, logIntegrationError } from "@/lib/logger";
import { cleanEmail } from "@/lib/emergencyContacts/identity";
import { addGroupMember, removeGroupMember, listGroupMembers } from "@/lib/googleGroups";

/** Just the program fields the sync needs — any full Program row satisfies it. */
export type ProgramGroupRef = { id: number; googleGroupEmail?: string | null };

/** Prisma select that pulls a person's own email + their household leads' emails
 * — the two inputs the recipient rule combines. */
const PERSON_EMAIL_SELECT = {
    email: true,
    household: {
        select: {
            householdMembers: {
                where: { isHouseholdLead: true },
                select: { email: true },
            },
        },
    },
} as const;

type PersonWithLeads = {
    email: string | null;
    household: { householdMembers: { email: string | null }[] } | null;
};

/** self + household-lead emails, deduped + lowercased (empty ones dropped). */
function collectEmails(person: PersonWithLeads): string[] {
    const set = new Set<string>();
    const self = cleanEmail(person.email);
    if (self) set.add(self);
    for (const lead of person.household?.householdMembers ?? []) {
        const e = cleanEmail(lead.email);
        if (e) set.add(e);
    }
    return [...set];
}

/** The group emails one participant contributes (self + their household leads).
 * Reads the Person, not the enrollment, so it works even after the participant
 * row has been deleted (the withdrawal path deletes first). */
export async function resolveGroupEmails(personId: number): Promise<string[]> {
    const person = await prisma.person.findUnique({ where: { id: personId }, select: PERSON_EMAIL_SELECT });
    return person ? collectEmails(person) : [];
}

/** The full desired membership for a program: every ACTIVE participant's
 * contributed emails. This is the reconcile target and the removal safety net
 * (a leaving person's shared household lead stays if another active kid needs it). */
async function desiredProgramEmails(programId: number): Promise<Set<string>> {
    const participants = await prisma.programParticipant.findMany({
        where: { programId, status: "ACTIVE" },
        select: { person: { select: PERSON_EMAIL_SELECT } },
    });
    const desired = new Set<string>();
    for (const p of participants) {
        for (const e of collectEmails(p.person)) desired.add(e);
    }
    return desired;
}

/** True when this program actually syncs (has a group AND creds are wired). */
function syncEnabled(program: ProgramGroupRef): program is ProgramGroupRef & { googleGroupEmail: string } {
    return !!program.googleGroupEmail && config.googleGroupsConfigured();
}

/**
 * Best-effort: add a newly-ACTIVE participant's emails to the program's group.
 * Adding is idempotent client-side, so no diff on the hot path. NEVER throws —
 * a Google failure must not fail the enrollment/payment action that triggered
 * this; it is logged + reported to Link Status, and the nightly reconcile heals.
 */
export async function pushGroupAddOnActivation(program: ProgramGroupRef, personId: number): Promise<void> {
    if (!program.googleGroupEmail) return;
    if (!config.googleGroupsConfigured()) {
        logger.info(`[GOOGLE-GROUPS] Skipping add for program ${program.id} — integration not configured.`);
        return;
    }
    const groupEmail = program.googleGroupEmail;
    try {
        const emails = await resolveGroupEmails(personId);
        for (const email of emails) await addGroupMember(groupEmail, email);
        if (emails.length) {
            logger.info(`[GOOGLE-GROUPS] Added ${emails.length} address(es) to ${groupEmail} for person ${personId} (program ${program.id}).`);
        }
    } catch (err) {
        logger.error(`[GOOGLE-GROUPS] Failed to add person ${personId} to ${groupEmail} (program ${program.id}):`, err);
        await logIntegrationError("google-groups", err, { operation: "add", programId: program.id, personId });
    }
}

/**
 * Best-effort: remove a withdrawn participant's emails from the program's group,
 * but only the ones no remaining ACTIVE participant still needs (a shared
 * household lead stays). Call AFTER the participant row is gone. NEVER throws —
 * same non-fatal posture as the add above.
 */
export async function pushGroupRemoveOnWithdrawal(program: ProgramGroupRef, personId: number): Promise<void> {
    if (!syncEnabled(program)) return;
    const groupEmail = program.googleGroupEmail;
    try {
        const emails = await resolveGroupEmails(personId);
        if (emails.length === 0) return;
        const stillDesired = await desiredProgramEmails(program.id); // roster AFTER this person left
        const toRemove = emails.filter((e) => !stillDesired.has(e));
        for (const email of toRemove) await removeGroupMember(groupEmail, email);
        if (toRemove.length) {
            logger.info(`[GOOGLE-GROUPS] Removed ${toRemove.length} address(es) from ${groupEmail} for person ${personId} (program ${program.id}).`);
        }
    } catch (err) {
        logger.error(`[GOOGLE-GROUPS] Failed to remove person ${personId} from ${groupEmail} (program ${program.id}):`, err);
        await logIntegrationError("google-groups", err, { operation: "remove", programId: program.id, personId });
    }
}

export type ReconcileResult =
    | { added: number; removed: number }
    | { skipped: string };

/**
 * Full diff for one program: add every desired-but-absent address, remove every
 * MEMBER-role address that is no longer an active participant. OWNER/MANAGER
 * roles are never removed (protects a human owner / the service account).
 * THROWS GoogleGroupsError on a Google failure — callers decide loudness (the
 * cron isolates + logs per program; the manual-sync route surfaces a 502).
 */
export async function reconcileProgramGroup(program: ProgramGroupRef): Promise<ReconcileResult> {
    if (!program.googleGroupEmail) return { skipped: "no group configured" };
    if (!config.googleGroupsConfigured()) return { skipped: "integration not configured" };
    const groupEmail = program.googleGroupEmail;

    const desired = await desiredProgramEmails(program.id);
    const members = await listGroupMembers(groupEmail);
    const currentEmails = new Set(members.map((m) => m.email));

    let added = 0;
    let removed = 0;

    for (const email of desired) {
        if (!currentEmails.has(email)) {
            await addGroupMember(groupEmail, email);
            added++;
        }
    }
    for (const m of members) {
        // Only reconcile MEMBER-role addresses; never remove OWNER/MANAGER.
        if (m.role === "MEMBER" && !desired.has(m.email)) {
            await removeGroupMember(groupEmail, m.email);
            removed++;
        }
    }

    return { added, removed };
}
