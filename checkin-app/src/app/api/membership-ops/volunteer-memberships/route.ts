import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { LIVE_PERSON } from "@/lib/person/filters";
import { IN_FLIGHT_INITIAL, IN_FLIGHT_RENEWAL } from "@/lib/membership/lifecycle";

export const dynamic = "force-dynamic";

/**
 * One volunteer roster row. Rows are HOUSEHOLD-grained because `isVolunteer`
 * lives on OrgMembership (one per household) — volunteer status is a property of
 * the family's dues, not of a person.
 */
export type VolunteerRowStatus =
    /** Volunteer membership, ACTIVE. */
    | "VOLUNTEER"
    /** Volunteer household part-way through intake or renewal. */
    | "IN_PROGRESS"
    /** Designated email with no volunteer membership yet. */
    | "DESIGNATED"
    /** Designated email whose household already holds an ACTIVE full-price membership. */
    | "FULL_PRICE"
    /** Volunteer membership the board revoked or denied. */
    | "REVOKED";

export interface VolunteerRow {
    key: string;
    status: VolunteerRowStatus;
    householdId: number | null;
    householdName: string | null;
    leads: string[];
    email: string | null;
    memberSince: string | null;
    /** Set when a VolunteerDesignation backs this row — drives the Remove action. */
    designationId: number | null;
    designatedAt: string | null;
}

const IN_FLIGHT = [...new Set([...IN_FLIGHT_INITIAL, ...IN_FLIGHT_RENEWAL])];

/** GET — the volunteer roster: current volunteer households + pre-designated emails. */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async () => {
    const [memberships, designations] = await Promise.all([
        prisma.orgMembership.findMany({
            where: { isVolunteer: true },
            select: {
                status: true,
                memberSince: true,
                household: {
                    select: {
                        id: true,
                        name: true,
                        householdMembers: {
                            where: { isHouseholdLead: true, ...LIVE_PERSON },
                            select: { name: true, email: true },
                            orderBy: { id: "asc" },
                        },
                    },
                },
                processes: { where: { status: { in: IN_FLIGHT } }, select: { id: true }, take: 1 },
            },
        }),
        prisma.volunteerDesignation.findMany({ orderBy: { createdAt: "desc" } }),
    ]);

    // Resolve each designated email to its person's household, so a designation
    // that already became a volunteer membership folds into that row instead of
    // listing twice.
    const emails = designations.map((d) => d.email);
    const people = emails.length
        ? await prisma.person.findMany({
              where: { email: { in: emails, mode: "insensitive" }, ...LIVE_PERSON },
              select: {
                  email: true,
                  household: {
                      select: {
                          id: true,
                          name: true,
                          orgMembership: {
                              select: {
                                  status: true,
                                  memberSince: true,
                                  processes: { where: { status: { in: IN_FLIGHT } }, select: { id: true }, take: 1 },
                              },
                          },
                          householdMembers: {
                              where: { isHouseholdLead: true, ...LIVE_PERSON },
                              select: { name: true },
                              orderBy: { id: "asc" },
                          },
                      },
                  },
              },
          })
        : [];

    const householdByEmail = new Map(
        people.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p.household]),
    );

    const rows: VolunteerRow[] = memberships.map((m) => ({
        key: `hh:${m.household.id}`,
        status:
            m.status === "ACTIVE"
                ? "VOLUNTEER"
                : m.status === "REVOKED" || m.status === "DENIED"
                  ? "REVOKED"
                  : m.processes.length > 0
                    ? "IN_PROGRESS"
                    : "DESIGNATED",
        householdId: m.household.id,
        householdName: m.household.name,
        leads: m.household.householdMembers.map((p) => p.name ?? "Unnamed"),
        email: m.household.householdMembers.find((p) => p.email)?.email ?? null,
        memberSince: m.status === "ACTIVE" ? m.memberSince.toISOString() : null,
        designationId: null,
        designatedAt: null,
    }));

    const rowByHousehold = new Map(rows.map((r) => [r.householdId, r]));

    for (const d of designations) {
        const household = householdByEmail.get(d.email.toLowerCase()) ?? null;
        const existing = household ? rowByHousehold.get(household.id) : undefined;
        // Already on the roster as a volunteer household — record the designation
        // on that row (so it stays removable) rather than adding a duplicate.
        if (existing) {
            existing.designationId = d.id;
            existing.designatedAt = d.createdAt.toISOString();
            continue;
        }
        const membership = household?.orgMembership ?? null;
        rows.push({
            key: `des:${d.id}`,
            status:
                membership?.status === "ACTIVE"
                    ? "FULL_PRICE"
                    : membership && membership.processes.length > 0
                      ? "IN_PROGRESS"
                      : "DESIGNATED",
            householdId: household?.id ?? null,
            householdName: household?.name ?? null,
            leads: household?.householdMembers.map((p) => p.name ?? "Unnamed") ?? [],
            email: d.email,
            memberSince: membership?.status === "ACTIVE" ? membership.memberSince.toISOString() : null,
            designationId: d.id,
            designatedAt: d.createdAt.toISOString(),
        });
    }

    return NextResponse.json({ rows });
});
