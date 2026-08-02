import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { LIVE_PERSON } from "@/lib/person/filters";
import { birthCutoff, memberYearStarts } from "@/lib/programYear";
import { calculateAge } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Board-only, read-only roster of the org's non-lead household members who are 18
 * or older as of a member-year start — the current one and the next, so the board
 * can see both who is already an adult this year and who ages in on the coming
 * boundary. Age is judged as-of each boundary, never as-of today.
 *
 * Household leads are excluded: this is the "child of the signer turns 18" list,
 * and a lead is the signer. Program enrollment rides along per row rather than
 * scoping the query — students in non-member households belong on the roster too,
 * and the view differentiates them instead of dropping them.
 *
 * People with no date of birth can't be judged at all, so they're returned as a
 * count: an unmeasurable row is a data-hygiene task, not an empty table cell.
 */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async () => {
    const settings = await prisma.boardSettings.findUnique({
        where: { id: 1 },
        select: { orgMembershipYearBoundary: true },
    });
    // No configured boundary means there is no member year to judge against.
    if (!settings?.orgMembershipYearBoundary) {
        return NextResponse.json({ currentYearStart: null, nextYearStart: null, rows: [], unknownDobCount: 0 });
    }
    const { current, next } = memberYearStarts(settings.orgMembershipYearBoundary, new Date());

    const people = await prisma.person.findMany({
        // 18 by the NEXT boundary is the superset — anyone already 18 at the
        // current one clears it too, and the per-row ages tell the two apart.
        where: { ...LIVE_PERSON, isHouseholdLead: false, dateOfBirth: { lte: birthCutoff(next) } },
        select: {
            id: true,
            name: true,
            dateOfBirth: true,
            household: { select: { id: true, name: true } },
            programParticipants: {
                where: { program: { phase: { not: "FINISHED" } } },
                select: { program: { select: { id: true, name: true } } },
            },
        },
        orderBy: { name: "asc" },
    });

    // isDeclaredAdult carries no DOB by design (a lead marked them 25+), so those
    // are known adults with nothing to chase — not a hygiene gap.
    const unknownDobCount = await prisma.person.count({
        where: { ...LIVE_PERSON, isHouseholdLead: false, dateOfBirth: null, isDeclaredAdult: false },
    });

    const rows = people.map((p) => {
        const dob = p.dateOfBirth as Date; // the lte filter above guarantees one
        return {
            personId: p.id,
            name: p.name || `Person #${p.id}`,
            householdId: p.household.id,
            householdName: p.household.name,
            dateOfBirth: dob.toISOString(),
            ageAtCurrent: calculateAge(dob, current),
            ageAtNext: calculateAge(dob, next),
            programs: p.programParticipants.map((pp) => pp.program),
        };
    });

    return NextResponse.json({
        currentYearStart: current.toISOString(),
        nextYearStart: next.toISOString(),
        rows,
        unknownDobCount,
    });
});
