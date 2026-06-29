import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

// Emergency contacts are their own entity now; the admin editor still works in
// terms of a single primary contact, so map the household's primary valid contact
// back onto the flat emergencyContactName/Phone shape the client expects. Include
// it inline (below) with this where/order so Prisma infers the result type.
const PRIMARY_CONTACT_WHERE = { conflictParticipantId: null, name: { not: "" }, phone: { not: "" } };
function withFlatContact<T extends { emergencyContacts: { name: string; phone: string }[] }>(h: T) {
    const primary = h.emergencyContacts[0] ?? null;
    const { emergencyContacts: _drop, ...rest } = h;
    void _drop;
    return { ...rest, emergencyContactName: primary?.name ?? null, emergencyContactPhone: primary?.phone ?? null };
}

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async (req) => {
        try {
            const url = new URL(req.url);
            const id = url.searchParams.get('id');
            const q = url.searchParams.get('q') || '';

            if (id) {
                const household = await prisma.household.findUnique({
                    where: { id: parseInt(id) },
                    include: {
                        participants: {
                            select: { id: true, name: true, email: true }
                        },
                        membership: true,
                        emergencyContacts: {
                            where: PRIMARY_CONTACT_WHERE,
                            orderBy: [{ priority: "asc" }, { id: "asc" }],
                            select: { name: true, phone: true },
                            take: 1,
                        },
                    }
                });
                return NextResponse.json({ household: household ? withFlatContact(household) : null });
            }

            const whereClause = q ? {
                OR: [
                    { name: { contains: q, mode: 'insensitive' as const } },
                    { participants: { some: { name: { contains: q, mode: 'insensitive' as const } } } },
                    { participants: { some: { email: { contains: q, mode: 'insensitive' as const } } } },
                ]
            } : {};

            const households = await prisma.household.findMany({
                where: whereClause,
                include: {
                    participants: {
                        select: { id: true, name: true, email: true, boardMember: true }
                    },
                    membership: true,
                    emergencyContacts: {
                        where: PRIMARY_CONTACT_WHERE,
                        orderBy: [{ priority: "asc" }, { id: "asc" }],
                        select: { name: true, phone: true },
                        take: 1,
                    },
                },
                orderBy: {
                    id: 'desc'
                },
                ...(q && { take: 20 })
            });

            return NextResponse.json({ households: households.map(withFlatContact) });
        } catch (error) {
            console.error("Failed to fetch households:", error);
            return NextResponse.json({ error: "Failed to fetch households" }, { status: 500 });
        }
    }
);

export const POST = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async (req, auth) => {
        try {
            const body = await req.json();
            const { householdId, active, deny } = body;

            if (!householdId) {
                return NextResponse.json({ error: "Household ID is required" }, { status: 400 });
            }

            const existingMembership = await prisma.membership.findUnique({
                where: { householdId }
            });

            // Deny / restore — a separate legal act from grant/revoke. Denying blocks login for
            // every member of the household (enforced in the auth layer).
            if (typeof deny === "boolean") {
                if (deny) {
                    // Two separate legal actions → two separate software actions: a household
                    // containing a board member cannot be denied. Remove the board role first.
                    // Enforced server-side; the UI's disabled button is only a courtesy.
                    const boardMemberInHousehold = await prisma.participant.findFirst({
                        where: { householdId, boardMember: true },
                        select: { id: true }
                    });
                    if (boardMemberInHousehold) {
                        return NextResponse.json(
                            { error: "This household includes a board member. Remove the board role before denying membership." },
                            { status: 409 }
                        );
                    }
                }

                const newStatus = deny ? "DENIED" : "NONE";
                const membership = await prisma.membership.upsert({
                    where: { householdId },
                    create: { householdId, status: newStatus },
                    update: { status: newStatus }
                });

                if (auth.type === 'session') {
                    await prisma.auditLog.create({
                        data: {
                            actorId: auth.user.id,
                            action: "EDIT",
                            tableName: "Membership",
                            affectedEntityId: membership.id,
                            secondaryAffectedEntity: householdId,
                            oldData: { status: existingMembership?.status ?? "NONE" },
                            newData: { status: newStatus }
                        }
                    });
                }

                return NextResponse.json({ success: true, membership });
            }

            if (active) {
                const membership = await prisma.membership.upsert({
                    where: { householdId },
                    create: { householdId, status: "ACTIVE" },
                    update: { status: "ACTIVE" }
                });
                if (auth.type === 'session') {
                    await prisma.auditLog.create({
                        data: {
                            actorId: auth.user.id,
                            action: "EDIT",
                            tableName: "Membership",
                            affectedEntityId: membership.id,
                            secondaryAffectedEntity: householdId,
                            oldData: { status: existingMembership?.status ?? "NONE" },
                            newData: { status: "ACTIVE" }
                        }
                    });
                }
                return NextResponse.json({ success: true, membership });
            } else if (existingMembership && existingMembership.status === "ACTIVE") {
                const membership = await prisma.membership.update({
                    where: { householdId },
                    data: { status: "REVOKED" }
                });
                if (auth.type === 'session') {
                    await prisma.auditLog.create({
                        data: {
                            actorId: auth.user.id,
                            action: "EDIT",
                            tableName: "Membership",
                            affectedEntityId: membership.id,
                            secondaryAffectedEntity: householdId,
                            oldData: { status: "ACTIVE" },
                            newData: { status: "REVOKED" }
                        }
                    });
                }
                return NextResponse.json({ success: true, message: "Membership deactivated" });
            }

            return NextResponse.json({ success: true, message: "No change needed" });
        } catch (error) {
            console.error("Failed to update household membership:", error);
            return NextResponse.json({ error: "Failed to update membership" }, { status: 500 });
        }
    }
);
