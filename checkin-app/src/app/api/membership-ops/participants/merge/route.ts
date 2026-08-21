import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Person } from "@/generated/prisma/client";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";
import { hasHouseholdConflict } from "@/lib/conflictOfInterest";
import { personBgOpen } from "@/lib/membership/lifecycle";
import { advanceHouseholdBgAfterMerge, householdBgFresh } from "@/lib/membership/mergeBgAdvance";
import { LIVE_PERSON } from "@/lib/person/filters";
import type { TxClient } from "@/lib/db-client";
import { householdMembershipStatus, membershipMergeBlock } from "./membershipGuard";

export const dynamic = 'force-dynamic';

// Fields eligible for a per-field conflict radio: both sides non-null and different.
// `image` auto-backfills only (never a radio, decision 4) so it's a separate list below.
// The login identity (email + googleId + emailVerified) is deliberately NOT here:
// those three are minted together at sign-in and are resolved as ONE unit under
// the `identity` key (see resolveKeeperUpdate), never split field-by-field —
// splitting could seat one side's email on the other's googleId, or graft a stale
// emailVerified onto a swapped-in address nobody proved they control (#1225).
const CONFLICT_FIELDS = ['name', 'phone', 'dateOfBirth'] as const;
// Single-sided auto-backfill fields (today's semantics) — the 3 conflict fields plus image.
const AUTO_BACKFILL_FIELDS = [...CONFLICT_FIELDS, 'image'] as const;
// The wholesale-choice key the client sends for the login identity conflict.
const IDENTITY_CHOICE_KEY = 'identity';
// Every valid fieldChoices key: the per-field radios plus the identity unit.
const VALID_CHOICE_KEYS = [...CONFLICT_FIELDS, IDENTITY_CHOICE_KEY] as const;

/** Thrown when the tombstone CAS loses the race (concurrent/repeat merge) — caught below and mapped to a 409. */
class AlreadyMergedError extends Error {}

function isEmpty(v: unknown): boolean {
    return v === null || v === undefined || v === '';
}

/** True conflict: both sides non-null/non-empty AND different. */
function valuesConflict(a: unknown, b: unknown): boolean {
    if (isEmpty(a) || isEmpty(b)) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() !== b.getTime();
    return a !== b;
}

/**
 * Pre-image of every field a merge can rewrite on EITHER side — the tombstone's
 * mangled identity and the keeper's overwritten name/email/DOB alike. Captured
 * before the transaction, because afterwards neither is readable.
 */
function personPreImage(p: Person) {
    return {
        id: p.id,
        googleId: p.googleId,
        email: p.email,
        emailVerified: p.emailVerified,
        emailSuppressed: p.emailSuppressed,
        phone: p.phone,
        name: p.name,
        dateOfBirth: p.dateOfBirth,
        image: p.image,
        lastWaiverSign: p.lastWaiverSign,
        lastBackgroundCheck: p.lastBackgroundCheck,
        isHouseholdLead: p.isHouseholdLead,
        householdId: p.householdId,
    };
}

/** A login identity is present iff email OR googleId is non-empty. */
function hasIdentity(p: { email: string | null; googleId: string | null }): boolean {
    return !isEmpty(p.email) || !isEmpty(p.googleId);
}

/**
 * Build the keeper's `person.update` data from: single-sided auto-backfill,
 * radio-resolved true conflicts (name/phone/dateOfBirth), the login identity
 * resolved as ONE unit (email + googleId + emailVerified), and the newer-date
 * auto-pick for the two compliance dates (never a radio).
 */
function resolveKeeperUpdate(
    keep: Person,
    merge: Person,
    choices: Partial<Record<string, 'keep' | 'merge'>>,
): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    for (const field of AUTO_BACKFILL_FIELDS) {
        const keepVal = keep[field];
        const mergeVal = merge[field];
        if (field !== 'image' && valuesConflict(keepVal, mergeVal)) {
            const choice = choices[field] ?? 'keep';
            if (choice === 'merge') data[field] = mergeVal;
            // 'keep' -> no write, keeper's existing value stands.
        } else if (isEmpty(keepVal) && !isEmpty(mergeVal)) {
            data[field] = mergeVal;
        }
    }

    // Login identity — email/googleId/emailVerified are minted together at
    // sign-in, so they move together or not at all. A record holds only one of
    // each (all @unique), so the only coherent outcomes are "keep the keeper's
    // whole identity" or "adopt the merge side's" — never a cross-side split
    // that would seat an address nobody proved they control (#1225).
    const keepHasIdentity = hasIdentity(keep);
    const mergeHasIdentity = hasIdentity(merge);
    const adoptMergeIdentity =
        // Both sides have one (always a true conflict — unique constraints):
        // client picks via the `identity` radio.
        (keepHasIdentity && mergeHasIdentity && choices[IDENTITY_CHOICE_KEY] === 'merge') ||
        // Empty keeper, merge side has one: adopt it (single-sided backfill).
        (!keepHasIdentity && mergeHasIdentity);
    if (adoptMergeIdentity) {
        data.email = merge.email;
        data.googleId = merge.googleId;
        data.emailVerified = merge.emailVerified;
        // #1225: suppression is tied to the address, so it rides in with it.
        data.emailSuppressed = merge.emailSuppressed;
    }
    // Only-keeper-has-identity (or 'keep' choice, or neither side) -> no write:
    // the keeper's address stands, and so does its own emailSuppressed.

    // Compliance dates: always take the newer one. Same human — an older check
    // is never the right survivor. Never a radio.
    for (const field of ['lastBackgroundCheck', 'lastWaiverSign'] as const) {
        const keepVal = keep[field];
        const mergeVal = merge[field];
        if (mergeVal != null && (keepVal == null || mergeVal.getTime() > keepVal.getTime())) {
            data[field] = mergeVal;
        }
    }

    return data;
}

/**
 * One human owes at most ONE open background check. Both merge subjects can hold an
 * open PERSON_BG, and re-pointing both at the survivor leaves two concurrent 2-of-N
 * reviews for the same person — the trigger's own dedupe never sees them (it runs at
 * create time). Keep the furthest-along row, archive the rest.
 *
 * Rank: BLOCKED outranks an open review — archiving a block in favour of a pending
 * row would erase a rejection and hand the person a fresh path to clearance. Then
 * more attestations, then consent recorded, then the older row.
 *
 * Attestations stay on the archived row: moving them onto the survivor would seat
 * reviewers past attest()'s same-household/already-attested gates, and the archived
 * row keeps the record. The audit row matches archiveApplication's shape, so the
 * board can unarchive one archived by mistake.
 *
 * No new lifecycle edge: this is the declared §13 archive transition
 * ({PENDING_BG_REVIEW,BLOCKED}→ARCHIVED) driven from a second site, and the CAS
 * from-state comes from the definition (`personBgOpen.where` covers both).
 */
async function archiveDuplicatePersonBg(tx: TxClient, personId: number, actorId: number): Promise<number> {
    const open = await tx.orgMembershipProcess.findMany({
        where: { kind: "PERSON_BG", subjectPersonId: personId, ...personBgOpen.where },
        select: { id: true, status: true, bgConsentAt: true, _count: { select: { attestations: true } } },
    });
    if (open.length < 2) return 0;

    const rank = (p: (typeof open)[number]) => [p.status === "BLOCKED" ? 1 : 0, p._count.attestations, p.bgConsentAt ? 1 : 0, -p.id];
    const [survivor, ...losers] = [...open].sort((a, b) => {
        const [ra, rb] = [rank(a), rank(b)];
        for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
        return 0;
    });

    let archived = 0;
    for (const loser of losers) {
        // CAS on the open set: a concurrent attest that just cleared or blocked this
        // row wins, and we leave it alone.
        const { count } = await tx.orgMembershipProcess.updateMany({
            where: { id: loser.id, ...personBgOpen.where },
            data: { status: "ARCHIVED", archivedFromStatus: loser.status, stageEnteredAt: new Date() },
        });
        if (count !== 1) continue;
        await tx.auditLog.create({
            data: {
                actorId,
                action: "EDIT",
                tableName: "OrgMembershipProcess",
                affectedEntityId: loser.id,
                oldData: { status: loser.status },
                newData: { status: "ARCHIVED", reason: "duplicate PERSON_BG resolved by participant merge", survivorProcessId: survivor.id },
            },
        });
        archived++;
    }
    return archived;
}

export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const body = await req.json();
            const { keepId, mergeId, fieldChoices } = body;

            if (!keepId || !mergeId || keepId === mergeId) {
                return apiError("Invalid participant IDs provided.", 400);
            }

            const mergeIncludes = {
                programParticipants: { include: { program: { select: { name: true } } } },
                programVolunteers: true,
                rsvps: { include: { event: { select: { name: true, startAt: true } } } },
                toolStatuses: { include: { tool: { select: { name: true } } } },
                bgAttestations: true,
                corporationLeads: true,
                corporationMembers: true,
            } as const;

            const keepParticipant = await prisma.person.findUnique({
                where: { id: keepId },
                include: {
                    ...mergeIncludes,
                    household: {
                        include: {
                            orgMembership: true
                        }
                    },
                }
            });

            const mergeParticipant = await prisma.person.findUnique({
                where: { id: mergeId },
                include: {
                    ...mergeIncludes,
                    household: {
                        include: {
                            // The lead guard below asks "would this leave live members
                            // leaderless" — tombstones are not members.
                            householdMembers: { where: LIVE_PERSON },
                            orgMembership: true
                        }
                    }
                }
            });

            if (!keepParticipant || !mergeParticipant) {
                return apiError("Participant(s) not found.", 404);
            }

            // Double-merge / merge-a-tombstone guard — either side, before opening the tx.
            if (keepParticipant.mergedIntoId != null || mergeParticipant.mergedIntoId != null) {
                return apiError("Cannot merge: one of these participants has already been merged.", 409);
            }

            // Conflict of interest: no actor may merge a record in their OWN household.
            // The merge takes the newer of the two lastBackgroundCheck dates
            // (resolveKeeperUpdate), so without this an actor can seat a background-check
            // date on their own family with no second actor — the thing attest() and
            // overrideBlocked refuse. Both subjects count: the tombstone's household is
            // where the carried date comes from, the keeper's is where it lands, and the
            // two need not be the same household. No role bypasses this.
            if (auth.type === 'session' && (
                await hasHouseholdConflict(prisma, auth.user.id, keepParticipant.householdId)
                || await hasHouseholdConflict(prisma, auth.user.id, mergeParticipant.householdId)
            )) {
                return apiError("You cannot merge a record in your own household — someone outside your household must.", 403);
            }

            const isLead = mergeParticipant.isHouseholdLead;
            const householdOthersCount = mergeParticipant.household?.householdMembers.filter(p => p.id !== mergeId).length || 0;

            if (isLead && householdOthersCount > 0) {
                return apiError("Cannot merge: the to-be-deleted participant is the lead of a household with other members.", 400);
            }

            // householdMembers is LIVE_PERSON-filtered above, so this is the count of
            // people who would still be left to use the household's membership.
            const membershipBlock = membershipMergeBlock(
                { status: householdMembershipStatus(keepParticipant.household) },
                { status: householdMembershipStatus(mergeParticipant.household), liveOthers: householdOthersCount },
            );
            if (membershipBlock) {
                return apiError(membershipBlock, 400);
            }

            // ---- Collision detection: refuse decision-bearing collisions (#1456 Phase 1) ----
            const collisions: Array<{ type: string; message: string }> = [];

            // ProgramParticipant — seat, payment, downstream RSVPs
            const ppCollisions = mergeParticipant.programParticipants.filter(pp =>
                keepParticipant.programParticipants.some(k => k.programId === pp.programId)
            );
            for (const pp of ppCollisions) {
                collisions.push({
                    type: 'programParticipant',
                    message: `Both enrolled in ${pp.program.name}. Unenroll one first.`,
                });
            }

            // ToolStatus — certification levels
            const tsCollisions = mergeParticipant.toolStatuses.filter(ts =>
                keepParticipant.toolStatuses.some(k => k.toolId === ts.toolId)
            );
            for (const ts of tsCollisions) {
                collisions.push({
                    type: 'toolStatus',
                    message: `Both hold a ${ts.tool.name} certification. Remove one first.`,
                });
            }

            // BackgroundCheckAttestation — same human reviewed under two identities
            const keepAttestProcesses = new Set(keepParticipant.bgAttestations.map(a => a.processId));
            const bgCollisions = mergeParticipant.bgAttestations.filter(a => keepAttestProcesses.has(a.processId));
            if (bgCollisions.length > 0) {
                collisions.push({
                    type: 'bgAttestation',
                    message: `Both attested the same background check (${bgCollisions.length} shared review${bgCollisions.length > 1 ? 's' : ''}). This indicates review under two identities — investigate before merging.`,
                });
            }

            // RSVP — future events only; past events auto-dedupe in the transaction
            const now = new Date();
            const futureRsvpCollisions = mergeParticipant.rsvps.filter(r =>
                r.event.startAt > now && keepParticipant.rsvps.some(k => k.eventId === r.eventId)
            );
            for (const r of futureRsvpCollisions) {
                collisions.push({
                    type: 'rsvp',
                    message: `Both RSVP'd to ${r.event.name}. Remove one RSVP first.`,
                });
            }

            // Open visits — both have an unfinished building visit
            const [keeperOpenVisit, mergeOpenVisit] = await Promise.all([
                prisma.visit.findFirst({ where: { personId: keepId, departedAt: null, deletedAt: null }, select: { id: true } }),
                prisma.visit.findFirst({ where: { personId: mergeId, departedAt: null, deletedAt: null }, select: { id: true } }),
            ]);
            if (keeperOpenVisit && mergeOpenVisit) {
                collisions.push({
                    type: 'openVisit',
                    message: 'Both have an open building visit. Close one visit first.',
                });
            }

            if (collisions.length > 0) {
                const detail = collisions.map(c => c.message).join('; ');
                return NextResponse.json({
                    error: `Cannot merge: ${detail}`,
                    collisions,
                }, { status: 409 });
            }

            // ---- Server-side fieldChoices validation (recompute conflicts; never trust the client's) ----
            const rawChoices = (fieldChoices ?? {}) as Record<string, unknown>;
            if (typeof rawChoices !== 'object' || rawChoices === null || Array.isArray(rawChoices)) {
                return apiError("Invalid fieldChoices", 400);
            }
            const choices: Partial<Record<string, 'keep' | 'merge'>> = {};
            for (const [key, value] of Object.entries(rawChoices)) {
                if (!(VALID_CHOICE_KEYS as readonly string[]).includes(key)) {
                    return apiError(`Unknown field choice: ${key}`, 400);
                }
                if (value !== 'keep' && value !== 'merge') {
                    return apiError(`Invalid choice for ${key}: must be 'keep' or 'merge'`, 400);
                }
                choices[key] = value;
            }
            for (const field of CONFLICT_FIELDS) {
                if (valuesConflict(keepParticipant[field], mergeParticipant[field]) && !choices[field]) {
                    return apiError(`Choose a value for ${field}`, 400);
                }
            }
            // Both sides carry a login identity => an unavoidable conflict (unique
            // constraints guarantee they differ); the client must pick which whole
            // identity survives.
            if (hasIdentity(keepParticipant) && hasIdentity(mergeParticipant) && !choices[IDENTITY_CHOICE_KEY]) {
                return apiError(`Choose a value for ${IDENTITY_CHOICE_KEY}`, 400);
            }

            // ---- Resolve the keeper's final field values, then guard against stranding login ----
            const keeperUpdateData = resolveKeeperUpdate(keepParticipant, mergeParticipant, choices);
            const finalEmail = 'email' in keeperUpdateData ? keeperUpdateData.email : keepParticipant.email;
            const finalGoogleId = 'googleId' in keeperUpdateData ? keeperUpdateData.googleId : keepParticipant.googleId;
            const hadLoginIdentity = !!(keepParticipant.email || keepParticipant.googleId || mergeParticipant.email || mergeParticipant.googleId);
            if (hadLoginIdentity && !finalEmail && !finalGoogleId) {
                return apiError("Merge would strand the login identity: choose a field value that keeps an email or Google account.", 400);
            }

            // The post-commit carryover below acts only on a household THIS merge made
            // background-check fresh, so it needs the pre-merge answer: afterwards the
            // keeper already carries the merged date and the two are indistinguishable.
            const bgFreshBeforeMerge = await householdBgFresh(keepParticipant.householdId);

            await prisma.$transaction(async (tx) => {
                // 1. Clear tombstone identity first (CAS) — frees the tombstone's unique
                // email/googleId so the keeper can adopt them below without a P2002.
                // updateMany (not update) so `mergedIntoId: null` is part of the write:
                // two concurrent merges targeting the same mergeId race on this row, and
                // exactly one wins — the loser's count is 0 and its tx rolls back.
                const cas = await tx.person.updateMany({
                    where: { id: mergeId, mergedIntoId: null },
                    data: {
                        mergedIntoId: keepId,
                        googleId: null,
                        email: `merged-${mergeId}@deleted.invalid`,
                        // Null the verified stamp with the identity: no tombstone
                        // row should carry a "verified" mark for the sentinel address.
                        emailVerified: null,
                        phone: null,
                        isHouseholdLead: false,
                        // NOTE: name is NOT mangled — mergedIntoId carries the semantics;
                        // the UI shows a "merged" badge wherever tombstones surface.
                    },
                });
                if (cas.count !== 1) throw new AlreadyMergedError();

                // 2. Apply keeper field choices (computed above, pre-tx).
                if (Object.keys(keeperUpdateData).length > 0) {
                    await tx.person.update({
                        where: { id: keepId },
                        data: keeperUpdateData
                    });
                }

                const moved = {
                    visits: 0,
                    personBgArchived: 0,
                    programParticipants: { migrated: 0, left: 0 },
                    programVolunteers: { migrated: 0, deduped: 0 },
                    rsvps: { migrated: 0, deduped: 0, left: 0 },
                    toolStatuses: { migrated: 0, left: 0 },
                    bgAttestations: { migrated: 0, left: 0 },
                    corporationLeads: { migrated: 0, deduped: 0 },
                    corporationMembers: { migrated: 0, deduped: 0 },
                };

                // 3. Move visits. Both-open was pre-refused (#1456); the guard below is
                // defense-in-depth for a TOCTOU race (visit opened between check and CAS).
                const keeperHasOpenVisit = await tx.visit.findFirst({ where: { personId: keepId, departedAt: null, deletedAt: null }, select: { id: true } });
                moved.visits = (await tx.visit.updateMany({
                    where: { personId: mergeId, ...(keeperHasOpenVisit ? { departedAt: { not: null } } : {}) },
                    data: { personId: keepId }
                })).count;

                // 4. Move join tables. Decision-bearing collisions (ProgramParticipant,
                // ToolStatus) were pre-refused; the `left` fallback is defense-in-depth
                // for a race. Bare-join collisions (ProgramVolunteer) auto-dedupe.
                for (const pp of mergeParticipant.programParticipants) {
                    if (!keepParticipant.programParticipants.find(k => k.programId === pp.programId)) {
                        await tx.programParticipant.update({
                            where: { programId_personId: { programId: pp.programId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.programParticipants.migrated++;
                    } else {
                        moved.programParticipants.left++;
                    }
                }

                for (const pv of mergeParticipant.programVolunteers) {
                    if (!keepParticipant.programVolunteers.find(k => k.programId === pv.programId)) {
                        await tx.programVolunteer.update({
                            where: { programId_personId: { programId: pv.programId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.programVolunteers.migrated++;
                    } else {
                        await tx.programVolunteer.delete({
                            where: { programId_personId: { programId: pv.programId, personId: mergeId } }
                        });
                        moved.programVolunteers.deduped++;
                    }
                }

                for (const rsvp of mergeParticipant.rsvps) {
                    if (!keepParticipant.rsvps.find(k => k.eventId === rsvp.eventId)) {
                        await tx.rSVP.update({
                            where: { eventId_personId: { eventId: rsvp.eventId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.rsvps.migrated++;
                    } else if (rsvp.event.startAt <= new Date()) {
                        await tx.rSVP.delete({
                            where: { eventId_personId: { eventId: rsvp.eventId, personId: mergeId } }
                        });
                        moved.rsvps.deduped++;
                    } else {
                        moved.rsvps.left++;
                    }
                }

                for (const tool of mergeParticipant.toolStatuses) {
                    if (!keepParticipant.toolStatuses.find(k => k.toolId === tool.toolId)) {
                        await tx.toolStatus.update({
                            where: { personId_toolId: { toolId: tool.toolId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.toolStatuses.migrated++;
                    } else {
                        moved.toolStatuses.left++;
                    }
                }

                // 5. Move the remaining MOVE relations (§4) — single updateMany, no delete.
                await tx.account.updateMany({ where: { userId: mergeId }, data: { userId: keepId } });
                // DELIBERATE exception to the no-deletion principle above: sessions are
                // auth artifacts, not person data, and there's no reason for the keeper
                // to inherit the tombstone's login session. Sessions are JWT-strategy, so
                // this row is not what ends the tombstone's access — the LIVE_PERSON filter
                // on the jwt() re-sync (auth-options.ts) collapses that token on next refresh.
                await tx.session.deleteMany({ where: { userId: mergeId } });
                await tx.orgMembershipProcess.updateMany({ where: { subjectPersonId: mergeId }, data: { subjectPersonId: keepId } });
                // Both sides can have owed a check — the survivor keeps exactly one.
                moved.personBgArchived = await archiveDuplicatePersonBg(tx, keepId, auth.type === 'session' ? auth.user.id : 0);
                await tx.program.updateMany({ where: { leadMentorId: mergeId }, data: { leadMentorId: keepId } });
                await tx.trustedAdult.updateMany({ where: { trustedAdultPersonId: mergeId }, data: { trustedAdultPersonId: keepId } });
                await tx.trustedAdult.updateMany({ where: { disclosedById: mergeId }, data: { disclosedById: keepId } });

                // bgAttestations: pre-refused collisions; left is defense-in-depth.
                // corporationLeads/corporationMembers: bare joins, auto-dedupe.
                const keepAttestProcessIds = new Set(keepParticipant.bgAttestations.map(a => a.processId));
                for (const att of mergeParticipant.bgAttestations) {
                    if (!keepAttestProcessIds.has(att.processId)) {
                        await tx.backgroundCheckAttestation.update({ where: { id: att.id }, data: { reviewerId: keepId } });
                        moved.bgAttestations.migrated++;
                    } else {
                        moved.bgAttestations.left++;
                    }
                }

                const keepCorpLeadIds = new Set(keepParticipant.corporationLeads.map(c => c.corporationId));
                for (const cl of mergeParticipant.corporationLeads) {
                    if (!keepCorpLeadIds.has(cl.corporationId)) {
                        await tx.corporationLead.update({
                            where: { corporationId_personId: { corporationId: cl.corporationId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.corporationLeads.migrated++;
                    } else {
                        await tx.corporationLead.delete({
                            where: { corporationId_personId: { corporationId: cl.corporationId, personId: mergeId } }
                        });
                        moved.corporationLeads.deduped++;
                    }
                }

                const keepCorpMemberIds = new Set(keepParticipant.corporationMembers.map(c => c.corporationId));
                for (const cm of mergeParticipant.corporationMembers) {
                    if (!keepCorpMemberIds.has(cm.corporationId)) {
                        await tx.corporationMember.update({
                            where: { corporationId_personId: { corporationId: cm.corporationId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.corporationMembers.migrated++;
                    } else {
                        await tx.corporationMember.delete({
                            where: { corporationId_personId: { corporationId: cm.corporationId, personId: mergeId } }
                        });
                        moved.corporationMembers.deduped++;
                    }
                }

                // 6. Household lead guard already ran pre-tx (see above). householdId stays
                // pointing at the old household: every participant must belong to one, and
                // merged-away records are tombstoned rather than deleted. Leadership was
                // cleared in step 1's CAS.

                // 8. Audit — tallies: migrated (repointed), deduped (bare-join duplicate
                // deleted), left (decision-bearing collision, defense-in-depth fallback).
                if (auth.type === 'session') {
                    await tx.auditLog.create({
                        data: {
                            actorId: auth.user.id,
                            action: "DELETE",
                            tableName: "Person",
                            affectedEntityId: keepId,
                            secondaryAffectedEntity: mergeId,
                            // Both pre-images, captured before either update ran: the
                            // merged-away Person at the top level, the keeper — whose
                            // name/email/DOB a field choice can overwrite — under `keeper`.
                            oldData: {
                                ...personPreImage(mergeParticipant),
                                keeper: personPreImage(keepParticipant),
                            },
                            newData: { keepId, fieldChoices: choices, moved },
                        }
                    });
                }
            });

            // The keeper may have just inherited a still-valid background check, which
            // can leave the household's parked application covered. Post-commit: the
            // survivor's live leads are only final once the tombstone's lead flag and
            // the keeper's date have landed. Never throws.
            //
            // Session actors only: this advances membership state, and the conflict-of-
            // interest guard above — the thing that stops an actor clearing their own
            // household — can only be applied to a session.
            if (auth.type === 'session') {
                await advanceHouseholdBgAfterMerge(keepParticipant.householdId, auth.user.id, mergeId, bgFreshBeforeMerge);
            }

            return NextResponse.json({ success: true });
        } catch (error: unknown) {
            if (error instanceof AlreadyMergedError) {
                return apiError("Cannot merge: this participant has already been merged.", 409);
            }
            const field = prismaUniqueConflictField(error);
            if (field) {
                const label = field === 'googleId' ? 'the Google identity'
                    : field === 'email' ? 'the email address'
                    : field === 'phone' ? 'the phone number'
                    : `the ${field} field`;
                return apiError(`Merge conflict: ${label} is already attached to another record.`, 409);
            }
            await logBackendError(error, "POST /api/membership-ops/participants/merge");
            return apiError("Failed to merge participants — check server logs for details.", 500);
        }
    }
);

// Prisma known-request errors carry a string `code` and, for P2002, a
// `meta.target` naming the colliding column(s). Duck-typed so we don't pull
// in the generated Prisma namespace just for one check. Returns the first
// colliding field name, or undefined if this isn't a P2002.
function prismaUniqueConflictField(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || (error as { code?: unknown }).code !== 'P2002') {
        return undefined;
    }
    const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
    if (Array.isArray(target)) return target[0];
    if (typeof target === 'string') return target;
    return 'unique';
}
