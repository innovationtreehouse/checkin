import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateRequest } from "@/lib/auth";

/**
 * Admin edit of a household's own info (name, address, emergency contact).
 *
 * Distinct from the participant-level "assign household" flow — this edits the
 * household record itself, on behalf of a member, using admin privileges. Gated
 * to sysadmin + board, and every edit is written to the audit log with before/
 * after snapshots since the actor is not a member of the household they touch.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await authenticateRequest(request);
    if (auth.type !== 'session') {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!auth.user.sysadmin && !auth.user.boardMember) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
        const data: {
            name?: string | null;
            address?: string | null;
            emergencyContactName?: string | null;
            emergencyContactPhone?: string | null;
        } = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.address !== undefined) data.address = body.address;
        if (body.emergencyContactName !== undefined) data.emergencyContactName = body.emergencyContactName;
        if (body.emergencyContactPhone !== undefined) data.emergencyContactPhone = body.emergencyContactPhone;

        if (Object.keys(data).length === 0) {
            return NextResponse.json({ error: "No fields to update provided" }, { status: 400 });
        }

        const updated = await prisma.household.update({ where: { id }, data });

        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: "EDIT",
                tableName: "Household",
                affectedEntityId: id,
                oldData: JSON.stringify({
                    name: existing.name,
                    address: existing.address,
                    emergencyContactName: existing.emergencyContactName,
                    emergencyContactPhone: existing.emergencyContactPhone,
                }),
                newData: JSON.stringify(data),
            }
        });

        return NextResponse.json({ household: updated });
    } catch (error) {
        console.error("Failed to update household:", error);
        return NextResponse.json({ error: "Failed to update household" }, { status: 500 });
    }
}
