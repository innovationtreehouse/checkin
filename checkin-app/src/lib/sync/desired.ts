// Desired-state computation for the Google Groups + Slack membership sync — the
// heart of the design (spec §0/§4.3). Pure-ish: reads prisma, makes no external
// calls. Emits the full desired tuple set for a moment in time; the reconcile
// (lib/sync/reconcile.ts) diffs it against the SyncState ledger. Recomputing this
// from live DB state every run is what makes boundary removal and the youth
// reason-union fall out of a diff, with no event bookkeeping (spec §0).
//
// LIVE_PERSON: every prisma.person.* call and every class-3 join-table call
// (programParticipant, programVolunteer — see src/__tests__/livePersonDriftGuard.test.ts)
// in this file MUST filter tombstoned (merged-away) people out of the live roster.
// A merge collision must never sync a tombstone into an external group.
//
// REVIEW ADDENDUM A3/A4 (binding): the direct-sync threshold is age 13+, not
// "adult" (Jeff: "e-mails for all persons age 13 or over"), and it stacks with the
// existing minor/lead-union rule rather than replacing it:
//   - age >= 13 (or unknown DOB, treated as adult — mirrors isYouth's convention)
//     AND has an email -> synced DIRECTLY.
//   - age < 18 (known DOB) -> household leads ALSO synced, whether or not the
//     person themselves was directly synced (13-17 stacks; under-13 or 13+-no-email
//     falls back to leads-only).
// A4: program staff (lead mentor + core ProgramVolunteer rows) get the program's
// group/channel too, under the same age/lead rule — "a staff member is realistically
// adult; do not special-case" means apply the SAME function, not skip it.

import prisma from "@/lib/prisma";
import { LIVE_PERSON } from "@/lib/person/filters";
import { calculateAge } from "@/lib/time";
import type { SyncTargetKind } from "@/generated/prisma/client";

export interface DesiredEntry {
    personId: number;
    email: string; // resolved live; entries with no email are dropped
    targetKind: SyncTargetKind;
    targetRef: string; // group email or slack channel id
    scope: string; // "program:<id>" | "org"
    reasons: string[]; // union tokens
    botTokenRef?: number; // programId, for slack_channel (token looked up at apply)
}

interface Candidate {
    id: number;
    email: string | null;
    dateOfBirth: Date | null;
    householdId: number;
}

interface Eligibility {
    /** age >= 13 (or unknown DOB) AND has an email — synced under their own identity. */
    directEligible: boolean;
    /** age < 18 with a known DOB — their household leads are synced too (stacks with direct). */
    isMinor: boolean;
}

function checkEligibility(person: { email: string | null; dateOfBirth: Date | null }, now: Date): Eligibility {
    const age = person.dateOfBirth ? calculateAge(person.dateOfBirth, now) : null;
    const isMinor = age !== null && age < 18;
    const directEligible = !!person.email && (age === null || age >= 13);
    return { directEligible, isMinor };
}

/** One (google_group/slack_channel/newsletter, targetRef) pair to fan a reason out to. */
interface Target {
    targetKind: SyncTargetKind;
    targetRef: string;
    botTokenRef?: number;
}

class DesiredStateBuilder {
    private readonly byKey = new Map<string, DesiredEntry>();
    private readonly leadsByHousehold = new Map<number, Candidate[]>();

    constructor(private readonly now: Date) {}

    private emit(personId: number, email: string, scope: string, target: Target, reason: string): void {
        if (!email) return;
        const key = `${personId}|${target.targetKind}|${target.targetRef}|${scope}`;
        const existing = this.byKey.get(key);
        if (existing) {
            if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
            return;
        }
        this.byKey.set(key, {
            personId,
            email,
            targetKind: target.targetKind,
            targetRef: target.targetRef,
            scope,
            reasons: [reason],
            ...(target.botTokenRef !== undefined ? { botTokenRef: target.botTokenRef } : {}),
        });
    }

    /** Household leads (LIVE_PERSON, isHouseholdLead, has email), cached per household for this run. */
    async getHouseholdLeads(householdId: number): Promise<Candidate[]> {
        const cached = this.leadsByHousehold.get(householdId);
        if (cached) return cached;
        const leads = await prisma.person.findMany({
            where: { householdId, isHouseholdLead: true, ...LIVE_PERSON },
            select: { id: true, email: true, dateOfBirth: true, householdId: true },
        });
        this.leadsByHousehold.set(householdId, leads);
        return leads;
    }

    /**
     * Emit a candidate person under `reason` for every target where directEligible,
     * and (stacking, not replacing) emit their household leads under `leadReason`
     * for every target whenever the candidate is a minor — regardless of whether
     * the candidate was also directly synced. See A3.
     */
    async emitPersonAndLeadUnion(
        person: Candidate,
        scope: string,
        targets: Target[],
        reason: string,
        leadReason: string,
    ): Promise<void> {
        const { directEligible, isMinor } = checkEligibility(person, this.now);
        if (directEligible && person.email) {
            for (const target of targets) this.emit(person.id, person.email, scope, target, reason);
        }
        if (isMinor) {
            const leads = await this.getHouseholdLeads(person.householdId);
            for (const lead of leads) {
                if (!lead.email || lead.id === person.id) continue;
                for (const target of targets) this.emit(lead.id, lead.email, scope, target, leadReason);
            }
        }
    }

    entries(): DesiredEntry[] {
        return [...this.byKey.values()];
    }
}

/** Programs contributing to sync: a group/channel configured AND not past its end
 *  boundary. `endAt` null-or-future; once `endAt < now` the program contributes
 *  NOTHING, so boundary removal falls out of the diff with no event bookkeeping. */
async function loadActivePrograms(now: Date) {
    return prisma.program.findMany({
        where: {
            AND: [
                { OR: [{ googleGroupEmail: { not: null } }, { slackChannelId: { not: null } }] },
                { OR: [{ endAt: null }, { endAt: { gte: now } }] },
            ],
        },
        select: { id: true, googleGroupEmail: true, slackChannelId: true, leadMentorId: true },
    });
}

function programTargets(program: {
    id: number;
    googleGroupEmail: string | null;
    slackChannelId: string | null;
}): Target[] {
    const targets: Target[] = [];
    if (program.googleGroupEmail) targets.push({ targetKind: "google_group", targetRef: program.googleGroupEmail });
    if (program.slackChannelId) {
        targets.push({ targetKind: "slack_channel", targetRef: program.slackChannelId, botTokenRef: program.id });
    }
    return targets;
}

async function loadPeople(ids: number[]): Promise<Map<number, Candidate>> {
    if (ids.length === 0) return new Map();
    const people = await prisma.person.findMany({
        where: { id: { in: ids }, ...LIVE_PERSON },
        select: { id: true, email: true, dateOfBirth: true, householdId: true },
    });
    return new Map(people.map((p) => [p.id, p]));
}

/** Reads live rosters/memberships/minors/leads/staff and returns the full desired
 *  tuple set, union-by-(personId,targetKind,targetRef,scope). */
export async function computeDesiredState(now: Date): Promise<DesiredEntry[]> {
    const builder = new DesiredStateBuilder(now);

    // ---- Programs: participants + staff (leads/core volunteers, A4) ----
    const programs = await loadActivePrograms(now);
    for (const program of programs) {
        const scope = `program:${program.id}`;
        const targets = programTargets(program);
        if (targets.length === 0) continue;

        // Participants (class-3 drift-guard site: person: LIVE_PERSON).
        const activeParticipants = await prisma.programParticipant.findMany({
            where: { programId: program.id, status: "ACTIVE", person: LIVE_PERSON },
            select: { personId: true },
        });
        const participantPeople = await loadPeople(activeParticipants.map((p) => p.personId));
        for (const person of participantPeople.values()) {
            await builder.emitPersonAndLeadUnion(
                person,
                scope,
                targets,
                `own_enrollment:program:${program.id}`,
                `minor_enrollment:program:${program.id}:person:${person.id}`,
            );
        }

        // Staff: lead mentor + core volunteers (A4). Same age/lead rule as anyone
        // else — "a staff member is realistically adult; do not special-case".
        const staffCandidateIds: { id: number; reason: string }[] = [];
        if (program.leadMentorId) {
            staffCandidateIds.push({ id: program.leadMentorId, reason: `staff_lead:program:${program.id}` });
        }
        // class-3 drift-guard site: person: LIVE_PERSON.
        const coreVolunteers = await prisma.programVolunteer.findMany({
            where: { programId: program.id, isCore: true, person: LIVE_PERSON },
            select: { personId: true },
        });
        for (const v of coreVolunteers) {
            staffCandidateIds.push({ id: v.personId, reason: `staff_corevol:program:${program.id}` });
        }
        if (staffCandidateIds.length > 0) {
            const staffPeople = await loadPeople(staffCandidateIds.map((s) => s.id));
            for (const staff of staffCandidateIds) {
                const person = staffPeople.get(staff.id);
                if (!person) continue; // tombstoned or not found — LIVE_PERSON dropped them
                await builder.emitPersonAndLeadUnion(
                    person,
                    scope,
                    targets,
                    staff.reason,
                    // A minor staff member is a realistic-world non-event, but the rule
                    // is applied uniformly (A4) — their leads would get the same staff reason.
                    staff.reason,
                );
            }
        }
    }

    // ---- Members group + Newsletter (org scope) ----
    const boardSettings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const membersGroupEmail = boardSettings?.membersGoogleGroupEmail ?? null;
    const newsletterGroupEmail = boardSettings?.newsletterGoogleGroupEmail ?? null;
    if (membersGroupEmail || newsletterGroupEmail) {
        const orgTargets: Target[] = [];
        if (membersGroupEmail) orgTargets.push({ targetKind: "google_group", targetRef: membersGroupEmail });
        // Newsletter uses the SAME add set as members (spec §4.3) but a distinct
        // target — the reconcile never removes newsletter rows (§5.3).
        if (newsletterGroupEmail) orgTargets.push({ targetKind: "newsletter", targetRef: newsletterGroupEmail });

        const activeHouseholds = await prisma.orgMembership.findMany({
            where: { status: "ACTIVE" },
            select: { householdId: true },
        });
        const members = await prisma.person.findMany({
            where: { householdId: { in: activeHouseholds.map((h) => h.householdId) }, ...LIVE_PERSON },
            select: { id: true, email: true, dateOfBirth: true, householdId: true },
        });
        for (const member of members) {
            await builder.emitPersonAndLeadUnion(
                member,
                "org",
                orgTargets,
                "own_membership",
                `minor_membership:person:${member.id}`,
            );
        }
    }

    return builder.entries();
}
