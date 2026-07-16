import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { reconcileAndWarn } from "@/lib/emergencyContacts/service";
import { isValidEmail } from "@/lib/emergencyContacts/identity";
import { isOrgAccount } from "@/lib/orgAccount";
import { HOUSEHOLD_PEER_SELECT } from "@/lib/household/participantProjection";
import { householdLeadship } from "@/lib/household/leads";
import { apiError } from "@/lib/api-response";

export const GET = withAuth(
    {},
    async (_req, auth) => {
        try {
            if (auth.type !== 'session') return apiError("Unauthorized", 401);
            const userId = auth.user.id;

            const user = await prisma.person.findUnique({
                where: { id: userId },
                include: {
                    household: {
                        include: {
                            householdMembers: { select: HOUSEHOLD_PEER_SELECT },
                            orgMembership: true,
                        }
                    }
                }
            });

            if (!user) return apiError("User not found", 404);

            return NextResponse.json({ household: user.household }, { status: 200 });
        } catch (error: unknown) {
            logger.error("Household GET Error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);

export const PATCH = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return apiError("Unauthorized", 401);
            const userId = auth.user.id;

            // Internal staff (@innovationtreehouse.org) accounts are not real member families,
            // so they may not build out a household with extra members via self-service. The
            // admin participant-add flow (isSysadmin/isBoardMember) is separate and stays open.
            if (isOrgAccount(auth.user)) {
                return apiError("Staff accounts cannot add household members. Use the membership-ops participant tools instead.", 403);
            }

            const body = await req.json();
            const { memberName, memberEmail, memberDob, memberOver25, memberAllergies } = body;

            const hh = await householdLeadship(userId);

            if (!hh) {
                return apiError("You must create a household first", 400);
            }

            if (!hh.canManage) {
                return apiError("Only household leads can add members", 403);
            }

            if (memberEmail && !isValidEmail(memberEmail)) {
                return apiError("Invalid email format", 400);
            }

            if (!memberDob && !memberOver25) {
                // A new member's age must be known: either a DoB, or an explicit
                // "25+" declaration (mirrors the client form's requirement).
                return apiError("Date of birth is required for anyone under 25.", 400);
            }

            const householdId = hh.householdId;

            const { member, warning } = await prisma.$transaction(async (tx) => {
                // Always create a fresh member — never reparent an existing account by
                // email. Real account linking happens at Google sign-in via
                // allowDangerousEmailAccountLinking (see lib/auth-options.ts). Attaching
                // here would let any lead absorb a known/guessed email into their household.
                const member = await tx.person.create({
                    data: {
                        name: memberName,
                        ...(memberEmail && { email: memberEmail.toLowerCase() }),
                        dateOfBirth: memberDob ? new Date(memberDob) : null,
                        isDeclaredAdult: !memberDob && !!memberOver25,
                        allergies: memberAllergies || null,
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
            // P2002 = unique violation on Person.email: the provided email already
            // belongs to some account. Return a generic, non-confirming validation
            // error framed around login-time linking — do NOT attach the existing
            // account, and do NOT confirm it exists.
            if (isPrismaError(error, 'P2002')) {
                return apiError("We couldn't add this member with that email. If they already have an account, they'll be linked automatically when they first sign in with Google using that email.", 400);
            }
            logger.error("Household PATCH Error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);

// Prisma known-request errors carry a string `code`. Duck-typed so we don't
// pull in the generated Prisma namespace just for one check.
function isPrismaError(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
        && (error as { code: unknown }).code === code;
}
