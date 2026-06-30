import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { withAuth } from "@/lib/auth";
import { handler } from "@/security/handler";

export const dynamic = 'force-dynamic';

// Emergency contacts are their own entity. The admin editor edits a single primary
// contact, so the GET nests the household's primary valid contact as an
// EmergencyContact row (selecting householdId so the field stripper can resolve its
// row scope). The client reads `emergencyContacts[0]`.
const PRIMARY_CONTACT_INCLUDE = {
    emergencyContacts: {
        where: { conflictParticipantId: null, name: { not: "" }, phone: { not: "" } },
        orderBy: [{ priority: "asc" as const }, { id: "asc" as const }],
        select: { id: true, householdId: true, name: true, phone: true },
        take: 1,
    },
} satisfies Prisma.HouseholdInclude;

// GET is field-stripped via the security registry (sysadmin/board see full
// participant + emergency-contact PII; a lesser role admitted would be stripped to
// public). Single (`?id=`) and list both return the `households` array envelope —
// `?id=` collapses to a one-element array.
export const GET = handler('GET /api/membership-ops/households', async ({ req }) => {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const q = url.searchParams.get('q') || '';

    if (id) {
        const household = await prisma.household.findUnique({
            where: { id: parseInt(id) },
            include: {
                participants: { select: { id: true, name: true, email: true } },
                membership: true,
                ...PRIMARY_CONTACT_INCLUDE,
            },
        });
        return { Household: household ? [household] : [] };
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
            participants: { select: { id: true, name: true, email: true, isBoardMember: true } },
            membership: true,
            ...PRIMARY_CONTACT_INCLUDE,
        },
        orderBy: { id: 'desc' },
        ...(q && { take: 20 })
    });

    return { Household: households };
});

export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
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
                        where: { householdId, isBoardMember: true },
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
