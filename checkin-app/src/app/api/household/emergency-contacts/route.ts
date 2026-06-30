import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { createContact, listContacts, EmergencyContactError } from "@/lib/emergencyContacts/service";
import { isValidEmail } from "@/lib/emergencyContacts/identity";

/** Shape a contact for the client, exposing the validity flag. */
function present(c: { id: number; name: string; phone: string; email: string | null; relationship: string | null; priority: number; conflictParticipantId: number | null }) {
    return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        relationship: c.relationship,
        priority: c.priority,
        invalid: c.conflictParticipantId !== null || !c.name.trim() || !c.phone.trim(),
    };
}

async function leadHousehold(userId: number): Promise<number | { error: string; status: number }> {
    const user = await prisma.participant.findUnique({ where: { id: userId }, include: { householdLeads: true } });
    if (!user?.householdId) return { error: "You must create a household first.", status: 400 };
    const isLead = user.householdLeads.some((l) => l.householdId === user.householdId);
    if (!isLead && !user.isSysadmin) return { error: "Only household leads can manage emergency contacts.", status: 403 };
    return user.householdId;
}

export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const hh = await leadHousehold(auth.user.id);
    if (typeof hh !== "number") return NextResponse.json({ error: hh.error }, { status: hh.status });
    const contacts = await listContacts(prisma, hh);
    return NextResponse.json({ contacts: contacts.map(present) });
});

export const POST = withAuth({}, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const hh = await leadHousehold(auth.user.id);
    if (typeof hh !== "number") return NextResponse.json({ error: hh.error }, { status: hh.status });

    try {
        const { name, phone, email, relationship, priority } = await req.json();
        if (email && !isValidEmail(email)) {
            return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
        }
        const contact = await createContact(prisma, hh, { name, phone, email, relationship, priority });
        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: "CREATE",
                tableName: "EmergencyContact",
                affectedEntityId: contact.id,
                secondaryAffectedEntity: hh,
                newData: { name: contact.name, phone: contact.phone },
            },
        });
        return NextResponse.json({ contact: present(contact) }, { status: 201 });
    } catch (error) {
        if (error instanceof EmergencyContactError) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("Emergency contact POST error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
