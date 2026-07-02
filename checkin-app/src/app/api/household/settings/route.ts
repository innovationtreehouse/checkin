import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { upsertPrimaryContact, EmergencyContactError } from "@/lib/emergencyContacts/service";
import { normalizeAddressInput, pickAddress, assertValidAddress, AddressValidationError } from "@/lib/address";

export const PATCH = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            const body = await req.json();
            const { emergencyContactName, emergencyContactPhone } = body;
            const addressData = normalizeAddressInput(body);
            // Address is optional on this route (emergency-contact-only PATCHes
            // send no address keys); when any address field is supplied, the
            // whole address must be complete + valid.
            if (Object.keys(addressData).length > 0) assertValidAddress(addressData);

            const user = await prisma.person.findUnique({
                where: { id: userId },
                include: { householdLeads: true }
            });

            if (!user || !user.householdId) {
                return NextResponse.json({ error: "Household not found" }, { status: 404 });
            }

            const isLead = user.householdLeads.some(lead => lead.householdId === user.householdId);
            if (!isLead && !user.isSysadmin) {
                return NextResponse.json({ error: "Only household leads can edit household settings" }, { status: 403 });
            }

            const updatedHousehold = await prisma.household.update({
                where: { id: user.householdId },
                data: addressData,
            });

            // Emergency contact is a separate entity; the settings form edits the
            // household's primary contact. Rejects a contact who is a member.
            if (emergencyContactName !== undefined || emergencyContactPhone !== undefined) {
                await upsertPrimaryContact(prisma, user.householdId, {
                    name: emergencyContactName,
                    phone: emergencyContactPhone,
                });
            }

            await prisma.auditLog.create({
                data: {
                    actorId: userId,
                    action: "EDIT",
                    tableName: "Household",
                    affectedEntityId: user.householdId,
                    newData: { emergencyContactName, emergencyContactPhone, ...pickAddress(updatedHousehold) }
                }
            });

            return NextResponse.json({ household: updatedHousehold }, { status: 200 });

        } catch (error: unknown) {
            if (error instanceof EmergencyContactError || error instanceof AddressValidationError) {
                return NextResponse.json({ error: error.message }, { status: 400 });
            }
            console.error("Household Settings PATCH Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
