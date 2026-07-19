import prisma from "@/lib/prisma";
import { LIVE_PERSON } from "@/lib/person/filters";
import { renewalSeasonWindow } from "@/lib/membership/renewal";
import { IN_FLIGHT_RENEWAL, IN_FLIGHT_INITIAL } from "@/lib/membership/lifecycle";
import { personRecordIsActiveOrgMember } from "@/lib/orgMembership";
import type { OrgMembershipProcessStatus } from "@/generated/prisma/client";

export type Audience = "a" | "b" | "c";
export type OutreachVariant = "join" | "renew";
export type ItemStatus = "queued" | "skipped_unsubscribed";

export interface RecipientSnapshotItem {
    personId: number;
    email: string;
    variant: OutreachVariant;
    status: ItemStatus;
}

export interface RecipientSnapshot {
    items: RecipientSnapshotItem[];
    /** isHouseholdLead && LIVE_PERSON && email == null, in the chosen audience's base
     * population — informational only, these leads get no item. */
    leadsWithoutEmail: number;
}

// Off-season / boundary-unset sentinel: `stageEnteredAt >= maxDate` matches nothing, so
// "settled" is false for everyone (mirrors membershipValidThrough, orgMembership.ts:95).
const MAX_DATE = new Date(8.64e15);

const IN_FLIGHT_STATUSES = new Set<OrgMembershipProcessStatus>([...IN_FLIGHT_RENEWAL, ...IN_FLIGHT_INITIAL]);

/** Compute the recipient snapshot for one audience preset (see spec §2.2). One query for the
 * candidate leads (with just enough of their household's membership to decide settled/
 * in-flight/variant in JS — no per-row N+1), one query for the without-email count. */
export async function computeRecipientSnapshot(audience: Audience, now = new Date()): Promise<RecipientSnapshot> {
    const window = await renewalSeasonWindow(now);
    const windowStart = window?.windowStart ?? MAX_DATE;

    const [leadsWithoutEmail, leads] = await Promise.all([
        prisma.person.count({ where: { isHouseholdLead: true, email: null, ...LIVE_PERSON } }),
        prisma.person.findMany({
            where: { isHouseholdLead: true, email: { not: null }, ...LIVE_PERSON },
            select: {
                id: true,
                email: true,
                emailSuppressed: true,
                household: {
                    select: {
                        orgMembership: {
                            select: {
                                status: true,
                                // Only the processes relevant to settled/in-flight decisions —
                                // computed ONCE per snapshot, not re-queried per household.
                                processes: {
                                    where: {
                                        OR: [
                                            { status: "ACTIVE", stageEnteredAt: { gte: windowStart } },
                                            { status: { in: [...IN_FLIGHT_STATUSES] } },
                                        ],
                                    },
                                    select: { status: true, stageEnteredAt: true },
                                },
                            },
                        },
                    },
                },
            },
        }),
    ]);

    const byEmail = new Map<string, { personId: number; email: string; variant: OutreachVariant; emailSuppressed: boolean }>();

    for (const lead of leads) {
        if (!lead.email) continue; // narrows for TS; the where already excludes this
        const membership = lead.household.orgMembership;
        const isMember = membership?.status === "ACTIVE";

        if (audience !== "c") {
            const settled = (membership?.processes ?? []).some(
                (p) => p.status === "ACTIVE" && p.stageEnteredAt != null && p.stageEnteredAt.getTime() >= windowStart.getTime(),
            );
            if (isMember && settled) continue; // excluded from both (a) and (b)

            if (audience === "b") {
                const inFlight = (membership?.processes ?? []).some((p) => IN_FLIGHT_STATUSES.has(p.status));
                if (inFlight) continue;
            }
        }

        const variant: OutreachVariant = personRecordIsActiveOrgMember({ household: { orgMembership: membership ?? null } })
            ? "renew"
            : "join";

        const key = lead.email.toLowerCase();
        const existing = byEmail.get(key);
        // Dedup by lowercased email (mirrors resolveHouseholdRecipients, emailRecipients.ts:31-38).
        // Person.email is @unique + auto-lowercased at write (prismaEmailNormalize.ts), so two
        // DISTINCT Person rows can't actually collide here today — this is defense-in-depth
        // matching that precedent, not a reachable case against the current schema. If any
        // duplicate resolves to a member, the renew variant wins for the merged item.
        if (!existing || (variant === "renew" && existing.variant !== "renew")) {
            byEmail.set(key, { personId: lead.id, email: lead.email, variant, emailSuppressed: lead.emailSuppressed });
        }
    }

    const items: RecipientSnapshotItem[] = [...byEmail.values()].map((r) => ({
        personId: r.personId,
        email: r.email,
        variant: r.variant,
        // Suppression is join-variant-only (binding decision, spec §2.4): renew recipients
        // are never dropped, and a suppressed join recipient is recorded (not silently
        // dropped) so the count/ledger stays honest.
        status: r.variant === "join" && r.emailSuppressed ? "skipped_unsubscribed" : "queued",
    }));

    return { items, leadsWithoutEmail };
}
