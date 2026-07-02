import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { upsertPrimaryContact, getPrimaryValidContact, EmergencyContactError } from "@/lib/emergencyContacts/service";
import { normalizeAddressInput, pickAddress, type StructuredAddress } from "@/lib/address";

/**
 * Admin edit of a household's own info (name, address, emergency contact).
 *
 * Distinct from the participant-level "assign household" flow — this edits the
 * household record itself, on behalf of a member, using admin privileges. Gated
 * to isSysadmin + board, and every edit is written to the audit log with before/
 * after snapshots since the actor is not a member of the household they touch.
 */
export const PATCH = withAuth<{ params: Promise<{ id: string }> }>(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (request: NextRequest, auth, { params }) => {
    if (auth.type !== 'session') {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { id: idParam } = await params;
        const id = parseInt(idParam, 10);
        if (isNaN(id)) {
            return NextResponse.json({ error: "Invalid household ID" }, { status: 400 });
        }

        const existing = await prisma.household.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: "Household not found" }, { status: 404 });
        }

        const body = await request.json();
        const data: { name?: string | null } & Partial<StructuredAddress> = {};
        if (body.name !== undefined) data.name = body.name;
        Object.assign(data, normalizeAddressInput(body));

        const editsContact = body.emergencyContactName !== undefined || body.emergencyContactPhone !== undefined;
        const editsHousehold = Object.keys(data).length > 0 || editsContact;

        // "Member since" lives on the household's Membership (1:1). Treat the date
        // as date-only: parse at UTC midnight and only act on a real change, so an
        // unchanged field re-sent by the form never writes a spurious audit row.
        let memberSinceChange: { membershipId: number; oldValue: Date; newValue: Date } | null = null;
        if (typeof body.memberSince === "string" && body.memberSince !== "") {
            const parsed = new Date(`${body.memberSince}T00:00:00.000Z`);
            if (isNaN(parsed.getTime())) {
                return NextResponse.json({ error: "Invalid member-since date" }, { status: 400 });
            }
            const membership = await prisma.membership.findUnique({ where: { householdId: id } });
            if (!membership) {
                return NextResponse.json({ error: "Household has no membership record" }, { status: 400 });
            }
            if (membership.memberSince.toISOString().slice(0, 10) !== body.memberSince) {
                memberSinceChange = { membershipId: membership.id, oldValue: membership.memberSince, newValue: parsed };
            }
        }

        if (!editsHousehold && !memberSinceChange) {
            return NextResponse.json({ error: "No fields to update provided" }, { status: 400 });
        }

        // Emergency contact is its own entity; the admin editor maps onto the
        // household's primary contact. Snapshot it before the change for the audit log.
        const priorContact = await getPrimaryValidContact(prisma, id);

        const updated = Object.keys(data).length > 0
            ? await prisma.household.update({ where: { id }, data })
            : existing;

        if (editsContact) {
            // Rejects (direction A) a contact who is a member of this household.
            await upsertPrimaryContact(prisma, id, { name: body.emergencyContactName, phone: body.emergencyContactPhone });
        }

        if (editsHousehold) {
            await prisma.auditLog.create({
                data: {
                    actorId: auth.user.id,
                    action: "EDIT",
                    tableName: "Household",
                    affectedEntityId: id,
                    oldData: {
                        name: existing.name,
                        ...pickAddress(existing),
                        emergencyContactName: priorContact?.name ?? null,
                        emergencyContactPhone: priorContact?.phone ?? null,
                    },
                    newData: { ...data, ...(editsContact && { emergencyContactName: body.emergencyContactName, emergencyContactPhone: body.emergencyContactPhone }) },
                }
            });
        }

        // Separate audit row for the membership edit — a legible before/after of the
        // join date on its own record, rather than folded into the Household row.
        if (memberSinceChange) {
            await prisma.membership.update({
                where: { id: memberSinceChange.membershipId },
                data: { memberSince: memberSinceChange.newValue },
            });
            await prisma.auditLog.create({
                data: {
                    actorId: auth.user.id,
                    action: "EDIT",
                    tableName: "Membership",
                    affectedEntityId: memberSinceChange.membershipId,
                    secondaryAffectedEntity: id,
                    oldData: { memberSince: memberSinceChange.oldValue },
                    newData: { memberSince: memberSinceChange.newValue },
                }
            });
        }

        return NextResponse.json({ household: updated });
    } catch (error) {
        if (error instanceof EmergencyContactError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        logger.error("Failed to update household:", error);
        return NextResponse.json({ error: "Failed to update household" }, { status: 500 });
    }
});
