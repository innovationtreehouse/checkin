import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { householdBgIsFresh, nextBoundary } from "@/lib/membership/renewal";
import { bgFreshThreshold, personBgVerdict } from "@/lib/membership/personBgCheck";
import { LIVE_PERSON } from "@/lib/person/filters";

export const dynamic = "force-dynamic";

/**
 * Board-only, PULL-ONLY membership compliance dashboard: households that have
 * fallen out of compliance but were NOT auto-terminated (the system deliberately
 * never auto-revokes — a human must follow up). Surfaces only what's knowable
 * from real data; there is no GRACE status modeled, so no grace bucket. Reasons:
 *   STALE_BG  — ACTIVE household whose background check aged past bgRecheckMonths
 *               (predicate owned by householdBgIsFresh; skipped when the board
 *               hasn't set the policy, i.e. bgRecheckMonths = 0).
 *   REVOKED / DENIED — OrgMembership status.
 *   STUCK_BG_CLEARANCE — a process parked at PENDING_BG_CLEARANCE (paid, never cleared).
 * A household with multiple problems gets all its reason tags.
 *
 * Also returns two PERSON-scoped lists (program people may not sit in a member
 * household, so they can't key on householdId):
 *   peopleNeedingBgCheck — program-attached people ≥18 (as of the boundary) with
 *                          no fresh check. Skipped when bgRecheckMonths = 0.
 *   peopleMissingDob     — program-attached people whose age is unknown (no DOB,
 *                          not declared 25+): data hygiene, NOT bg-needed.
 *
 * And two lists of background-check dates that trace to no named person (#1260):
 *   blanketStamped          — households cleared before per-adult subjects existed,
 *                             where every lead was stamped. One-time cleanup; narrow
 *                             it with ?bgClearedSince=YYYY-MM-DD.
 *   mergeInheritedBgChecks  — survivors of a person merge who took the merged-away
 *                             record's date. Permanent until #1396 closes that hole.
 */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req) => {
    const sinceParam = new URL(req.url).searchParams.get("bgClearedSince");
    const since = sinceParam ? new Date(sinceParam) : null;
    const bgClearedSince = since && !Number.isNaN(since.getTime()) ? since : null;
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const bgRecheckMonths = settings?.bgRecheckMonths ?? 0;
    const boundary = settings?.orgMembershipYearBoundary
        ? nextBoundary(settings.orgMembershipYearBoundary, new Date())
        : new Date();

    // householdId -> Set<reason>
    const reasons = new Map<number, Set<string>>();
    const add = (householdId: number, reason: string) => {
        const set = reasons.get(householdId) ?? new Set<string>();
        set.add(reason);
        reasons.set(householdId, set);
    };

    // 1. Stale background check — only when the board has configured a window.
    //    Reuse householdBgIsFresh per household (stale = returns false); when
    //    bgRecheckMonths = 0 it always returns false, so skip the whole bucket.
    if (bgRecheckMonths > 0) {
        const active = await prisma.orgMembership.findMany({
            where: { status: "ACTIVE" },
            select: { householdId: true },
        });
        for (const m of active) {
            const fresh = await householdBgIsFresh(m.householdId, boundary, bgRecheckMonths);
            if (!fresh) add(m.householdId, "STALE_BG");
        }
    }

    // 2. REVOKED / DENIED memberships — tag which.
    const revokedDenied = await prisma.orgMembership.findMany({
        where: { status: { in: ["REVOKED", "DENIED"] } },
        select: { householdId: true, status: true },
    });
    for (const m of revokedDenied) add(m.householdId, m.status);

    // 3. Stuck at BG clearance — paid but never cleared.
    const stuck = await prisma.orgMembershipProcess.findMany({
        where: { status: "PENDING_BG_CLEARANCE" },
        select: { orgMembership: { select: { householdId: true } } },
    });
    // PENDING_BG_CLEARANCE is a household-process status; orgMembership is always set.
    for (const p of stuck) if (p.orgMembership) add(p.orgMembership.householdId, "STUCK_BG_CLEARANCE");

    // 4. Program-attached people ≥18 without a fresh background check (warn-only).
    //    Subject = union of ProgramParticipant / ProgramVolunteer / Program.leadMentor.
    //    A program lead/volunteer may sit in a household that isn't a member household,
    //    so these are person-scoped, NOT folded into the householdId reason map above.
    //    Skip the whole bucket when the board hasn't set a recheck window, exactly
    //    like STALE_BG — bgRecheckMonths = 0 means "no policy", nothing is stale.
    type PersonRow = {
        personId: number;
        name: string;
        householdId: number;
        programId: number | null;
        programName: string | null;
        reason: string;
    };
    const peopleNeedingBgCheck: PersonRow[] = [];
    const peopleMissingDob: PersonRow[] = [];
    if (bgRecheckMonths > 0) {
        const threshold = bgFreshThreshold(boundary, bgRecheckMonths);
        const people = await prisma.person.findMany({
            where: {
                OR: [
                    { programParticipants: { some: {} } },
                    { programVolunteers: { some: {} } },
                    { programsLed: { some: {} } },
                ],
                ...LIVE_PERSON,
            },
            select: {
                id: true,
                name: true,
                householdId: true,
                dateOfBirth: true,
                isDeclaredAdult: true,
                lastBackgroundCheck: true,
                programParticipants: { select: { program: { select: { id: true, name: true } } } },
                programVolunteers: { select: { program: { select: { id: true, name: true } } } },
                programsLed: { select: { id: true, name: true } },
            },
            orderBy: { name: "asc" },
        });
        for (const p of people) {
            const verdict = personBgVerdict(p, boundary, threshold);
            if (verdict === "FRESH" || verdict === "MINOR") continue;
            // One program for context — first attachment found across the three roles.
            const prog =
                p.programParticipants[0]?.program ??
                p.programVolunteers[0]?.program ??
                p.programsLed[0] ??
                null;
            const row: PersonRow = {
                personId: p.id,
                name: p.name || `Person #${p.id}`,
                householdId: p.householdId,
                programId: prog?.id ?? null,
                programName: prog?.name ?? null,
                reason: verdict === "DOB_MISSING" ? "DOB_MISSING" : "PERSON_BG_NEEDED",
            };
            (verdict === "DOB_MISSING" ? peopleMissingDob : peopleNeedingBgCheck).push(row);
        }
    }

    // 5. Blanket-stamped background checks (#1260). Before per-adult subjects, clearing
    //    a household check stamped EVERY lead with the process's own bgClearedAt — one
    //    `new Date()` wrote both, so equality to the millisecond is an exact join key,
    //    not a heuristic. Three classes fall out on their own: single-lead households
    //    (never two matching leads), the fresh-check intake/renewal shortcut (stamps
    //    bgClearedAt without touching any Person, so it matches none), and PERSON_BG
    //    (excluded by subjectPersonId). A clearance under per-adult rules is excluded
    //    by carrying at least one subject-named attestation.
    const clearedProcesses = await prisma.orgMembershipProcess.findMany({
        where: {
            subjectPersonId: null,
            bgClearedAt: bgClearedSince ? { gte: bgClearedSince } : { not: null },
        },
        select: {
            id: true,
            bgClearedAt: true,
            attestations: { select: { subjectPersonId: true } },
            orgMembership: {
                select: {
                    household: {
                        select: {
                            id: true,
                            name: true,
                            householdMembers: {
                                where: { isHouseholdLead: true, ...LIVE_PERSON },
                                select: { id: true, name: true, email: true, lastBackgroundCheck: true },
                            },
                        },
                    },
                },
            },
        },
        orderBy: { bgClearedAt: "desc" },
    });

    const suspect = clearedProcesses
        .map((p) => ({
            process: p,
            household: p.orgMembership?.household ?? null,
            stamped: (p.orgMembership?.household?.householdMembers ?? []).filter(
                (l) => l.lastBackgroundCheck?.getTime() === p.bgClearedAt!.getTime(),
            ),
        }))
        .filter((s) => s.household !== null && s.stamped.length > 1 && s.process.attestations.every((a) => a.subjectPersonId === null));

    // markBgConsent writes exactly one audit row per process with newData.bgConsentAt =
    // true, and its actor is whoever recorded the consent: the applicant themselves on
    // the primary path, a board member on the backstop. A lead who attested their own
    // consent is the best evidence available of who actually went to Averity — labelled
    // for the board, never pre-selected and never auto-cleared.
    const consentActorByProcess = new Map<number, number>();
    if (suspect.length) {
        const logs = await prisma.auditLog.findMany({
            where: { tableName: "OrgMembershipProcess", affectedEntityId: { in: suspect.map((s) => s.process.id) } },
            select: { affectedEntityId: true, actorId: true, newData: true },
        });
        for (const l of logs) {
            if ((l.newData as { bgConsentAt?: boolean } | null)?.bgConsentAt === true) {
                consentActorByProcess.set(l.affectedEntityId, l.actorId);
            }
        }
    }
    const blanketStamped = suspect.map(({ process, household, stamped }) => {
        const consentActorId = consentActorByProcess.get(process.id) ?? null;
        return {
            processId: process.id,
            householdId: household!.id,
            householdName: household!.name || `Household #${household!.id}`,
            bgClearedAt: process.bgClearedAt!.toISOString(),
            // Who recorded consent is only useful as "was it one of these leads" — the
            // actor's own name would be the board member on the backstop path, which
            // tells the board nothing about which report was reviewed.
            consentRecorded: consentActorId !== null,
            leads: stamped.map((l) => ({
                personId: l.id,
                name: l.name || l.email || `Person #${l.id}`,
                email: l.email,
                likelySubject: consentActorId === l.id,
            })),
        };
    });

    // 6. Background-check dates that arrived through a person merge (#1396). The merge
    //    rule takes the later of the two dates unconditionally, with no record of whose
    //    check it was, so a survivor can hold a date that traces to nobody. Unlike the
    //    blanket stamps this list never empties on its own — every future merge can mint
    //    another — so it stays after the one-time cleanup is done.
    const survivors = await prisma.person.findMany({
        where: {
            lastBackgroundCheck: { not: null },
            mergedFrom: { some: { lastBackgroundCheck: { not: null } } },
            ...LIVE_PERSON,
        },
        select: {
            id: true,
            name: true,
            email: true,
            householdId: true,
            lastBackgroundCheck: true,
            mergedFrom: { select: { id: true, name: true, lastBackgroundCheck: true } },
        },
        orderBy: { name: "asc" },
    });
    const mergeInheritedBgChecks = survivors
        .map((s) => ({
            survivor: s,
            source: s.mergedFrom.find((m) => m.lastBackgroundCheck?.getTime() === s.lastBackgroundCheck!.getTime()),
        }))
        .filter((r) => r.source !== undefined)
        .map(({ survivor, source }) => ({
            personId: survivor.id,
            name: survivor.name || survivor.email || `Person #${survivor.id}`,
            householdId: survivor.householdId,
            lastBackgroundCheck: survivor.lastBackgroundCheck!.toISOString(),
            fromName: source!.name || `Person #${source!.id}`,
        }));

    if (reasons.size === 0) {
        return NextResponse.json({ households: [], peopleNeedingBgCheck, peopleMissingDob, blanketStamped, mergeInheritedBgChecks });
    }

    const households = await prisma.household.findMany({
        where: { id: { in: [...reasons.keys()] } },
        include: {
            householdMembers: {
                where: { isHouseholdLead: true, ...LIVE_PERSON },
                select: { id: true, name: true, phone: true, email: true, lastBackgroundCheck: true },
            },
        },
        orderBy: { name: "asc" },
    });

    const result = households.map((h) => {
        const checks = h.householdMembers
            .map((p) => p.lastBackgroundCheck)
            .filter((d): d is Date => d !== null);
        // Most recent lead check — the date the board is chasing on a STALE_BG row.
        const lastBackgroundCheck = checks.length
            ? checks.reduce((a, b) => (a > b ? a : b)).toISOString()
            : null;
        return {
            id: h.id,
            name: h.name || `Household #${h.id}`,
            reasons: [...(reasons.get(h.id) ?? [])],
            lastBackgroundCheck,
            leads: h.householdMembers.map((p) => ({
                id: p.id,
                name: p.name,
                phone: p.phone,
                email: p.email,
            })),
        };
    });

    return NextResponse.json({ households: result, peopleNeedingBgCheck, peopleMissingDob, blanketStamped, mergeInheritedBgChecks });
});
