import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { reconcileAndWarn } from "@/lib/emergencyContacts/service";
import { isValidEmail } from "@/lib/emergencyContacts/identity";
import { isOrgAccount } from "@/lib/orgAccount";
import { HOUSEHOLD_PEER_SELECT } from "@/lib/household/participantProjection";

export const GET = withAuth(
    {},
    async (_req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            const user = await prisma.participant.findUnique({
                where: { id: userId },
                include: {
                    household: {
                        include: {
                            participants: { select: HOUSEHOLD_PEER_SELECT },
                            leads: true,
                            membership: true,
                        }
                    }
                }
            });

            if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

            return NextResponse.json({ household: user.household }, { status: 200 });
        } catch (error: unknown) {
            console.error("Household GET Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);

export const PATCH = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            // Internal staff (@innovationtreehouse.org) accounts are not real member families,
            // so they may not build out a household with extra members via self-service. The
            // admin participant-add flow (isSysadmin/isBoardMember) is separate and stays open.
            if (isOrgAccount(auth.user)) {
                return NextResponse.json(
                    { error: "Staff accounts cannot add household members. Use the membership-ops participant tools instead." },
                    { status: 403 }
                );
            }

            const body = await req.json();
            const { memberName, memberEmail, memberDob, memberOver25 } = body;

            const user = await prisma.participant.findUnique({ where: { id: userId }, include: { householdLeads: true } });

            if (!user?.householdId) {
                return NextResponse.json({ error: "You must create a household first" }, { status: 400 });
            }

            const isLead = user.householdLeads.some(lead => lead.householdId === user.householdId);
            if (!isLead && !user.isSysadmin) {
                return NextResponse.json({ error: "Only household leads can add members" }, { status: 403 });
            }

            if (memberEmail && !isValidEmail(memberEmail)) {
                return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
            }

            let targetMember: Awaited<ReturnType<typeof prisma.participant.findUnique>> = null;

            if (memberEmail) {
                targetMember = await prisma.participant.findUnique({ where: { email: memberEmail.toLowerCase() } });

                if (targetMember && targetMember.householdId) {
                    return NextResponse.json({ error: "A user with this email already belongs to a household." }, { status: 400 });
                }
            }

            if (!targetMember && !memberDob && !memberOver25) {
                // A new member's age must be known: either a DoB, or an explicit
                // "25+" declaration (mirrors the client form's requirement).
                return NextResponse.json({ error: "Date of birth is required for anyone under 25." }, { status: 400 });
            }

            const householdId = user.householdId;

            const { member, warning } = await prisma.$transaction(async (tx) => {
                const member = targetMember
                    ? await tx.participant.update({
                        where: { id: targetMember.id },
                        data: { householdId },
                        select: HOUSEHOLD_PEER_SELECT,
                    })
                    : await tx.participant.create({
                        data: {
                            name: memberName,
                            ...(memberEmail && { email: memberEmail.toLowerCase() }),
                            dateOfBirth: memberDob ? new Date(memberDob) : null,
                            isDeclaredAdult: !memberDob && !!memberOver25,
                            householdId,
                        },
                        select: HOUSEHOLD_PEER_SELECT,
                    });

                await tx.auditLog.create({
                    data: {
                        actorId: userId,
                        action: "EDIT",
                        tableName: "Participant",
                        affectedEntityId: member.id,
                        newData: { householdId, email: member.email, name: member.name }
                    }
                });

                // A newly-added member may be an existing emergency contact (direction
                // B): flag the colliding contact and warn the lead to add a replacement.
                const warning = await reconcileAndWarn(tx, householdId);

                return { member, warning };
            });

            return NextResponse.json({ member, warning }, { status: 200 });
        } catch (error: unknown) {
            console.error("Household PATCH Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
