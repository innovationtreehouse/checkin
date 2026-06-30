import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { createContact, listContacts, EmergencyContactError } from "@/lib/emergencyContacts/service";

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
    if (!isLead && !user.sysadmin) return { error: "Only household leads can manage emergency contacts.", status: 403 };
    return user.householdId;
}

// SECURITY — deliberately on withAuth(), NOT the handler() field-stripper
// (P0-B4a step 3, decision 3b). leadHousehold() admits only a lead (or sysadmin)
// of the caller's OWN household, so every admitted caller is entitled to all of
// it — there is no mixed-role over-exposure for the stripper to remove. Migrating
// would be a no-op AND mildly worse: the `invalid` badge derives from
// conflictParticipantId (internal tier), so handler() adoption would force
// granting their_households:internal, leaking conflictedAt/createdAt/updatedAt to
// the wire to reconstruct a flag the server already computes. See
// docs/designs/p0-b4a-household-handler-migration.md.
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
        const contact = await createContact(prisma, hh, { name, phone, email, relationship, priority });
        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: "CREATE",
                tableName: "EmergencyContact",
                affectedEntityId: contact.id,
                secondaryAffectedEntity: hh,
                newData: JSON.stringify({ name: contact.name, phone: contact.phone }),
            },
        });
        return NextResponse.json({ contact: present(contact) }, { status: 201 });
    } catch (error) {
        if (error instanceof EmergencyContactError) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("Emergency contact POST error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
