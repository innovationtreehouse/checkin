import { NextRequest, NextResponse } from "next/server";
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
        if (Object.keys(data).length === 0 && !editsContact) {
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

        return NextResponse.json({ household: updated });
    } catch (error) {
        if (error instanceof EmergencyContactError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("Failed to update household:", error);
        return NextResponse.json({ error: "Failed to update household" }, { status: 500 });
    }
});
