import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import {
    ROLE_FLAGS,
    type RoleFlag,
    rolesToFlags,
    setRoleFlag,
    RoleMatrixError,
    LastBoardMemberError,
} from "@/lib/roles";
import { LIVE_PERSON } from "@/lib/person/filters";

const PERSON_SELECT = {
    id: true,
    email: true,
    name: true,
} as const;

/** Thrown inside the tx when `targetUserId` does not resolve to a Person. */
class TargetNotFoundError extends Error {}

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async () => {
        try {
            const eighteenYearsAgo = new Date();
            eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

            const rows = await prisma.person.findMany({
                where: LIVE_PERSON,
                select: {
                    id: true,
                    email: true,
                    name: true,
                    dateOfBirth: true,
                    roles: { select: { role: true } },
                },
                orderBy: { name: "asc" },
            });
            // Don't leak dob (PII); expose only a youth flag for filtering. isOperations has
            // no column, so every flag is derived through the one `roles` relation.
            const people = rows.map(({ dateOfBirth, roles, ...p }) => ({
                ...p,
                ...rolesToFlags(roles),
                isYouth: dateOfBirth != null && dateOfBirth > eighteenYearsAgo,
            }));
            return NextResponse.json({ people });
        } catch (error) {
            logger.error("Error fetching roles:", error);
            return apiError("Internal server error", 500);
        }
    }
);

export const PATCH = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            if (auth.type !== 'session') {
                return apiError("Forbidden", 403);
            }
            const actor = auth.user;

            const body = await req.json();
            const { targetUserId, ...roleUpdates } = body;

            if (!targetUserId) {
                return apiError("Missing 'targetUserId'", 400);
            }

            const unknownKey = Object.keys(roleUpdates).find((k) => !ROLE_FLAGS.includes(k as RoleFlag));
            if (unknownKey) {
                return apiError(`Unknown role flag: ${unknownKey}`, 400);
            }

            const requested: Partial<Record<RoleFlag, boolean>> = {};
            for (const field of ROLE_FLAGS) {
                if (roleUpdates[field] !== undefined) {
                    requested[field] = Boolean(roleUpdates[field]);
                }
            }

            if (Object.keys(requested).length === 0) {
                return apiError("No valid role fields provided", 400);
            }

            const result = await prisma.$transaction(async (tx) => {
                const target = await tx.person.findUnique({
                    where: { id: targetUserId },
                    select: PERSON_SELECT,
                });
                if (!target) throw new TargetNotFoundError();

                // Delta + audit are built from setRoleFlag's post-lock read, so the
                // no-op check and the recorded before/after are consistent with the
                // write (thpr C). One call per requested flag; no-ops report changed:false.
                const oldData: Partial<Record<RoleFlag, boolean>> = {};
                const newData: Partial<Record<RoleFlag, boolean>> = {};
                for (const field of Object.keys(requested) as RoleFlag[]) {
                    const { changed, before, after } = await setRoleFlag(
                        tx, targetUserId, field, requested[field]!, actor,
                    );
                    if (changed) {
                        oldData[field] = before;
                        newData[field] = after;
                    }
                }

                if (Object.keys(newData).length > 0) {
                    await tx.auditLog.create({
                        data: {
                            actorId: actor.id,
                            action: "EDIT",
                            tableName: "PersonRole",
                            affectedEntityId: targetUserId,
                            oldData,
                            newData,
                        },
                    });
                }

                // Post-write read for the response's full flag set (lock already held).
                const rows = await tx.personRole.findMany({
                    where: { personId: targetUserId },
                    select: { role: true },
                });
                return { user: { id: target.id, email: target.email, name: target.name, ...rolesToFlags(rows) } };
            });

            return NextResponse.json({ message: "Roles updated successfully", user: result.user });
        } catch (error) {
            if (error instanceof TargetNotFoundError) {
                return apiError("No such user", 404);
            }
            if (error instanceof RoleMatrixError) {
                return apiError(error.message, 403);
            }
            if (error instanceof LastBoardMemberError) {
                return apiError("Cannot remove the last board member", 409);
            }
            logger.error("Error updating role:", error);
            return apiError("Internal server error", 500);
        }
    }
);
