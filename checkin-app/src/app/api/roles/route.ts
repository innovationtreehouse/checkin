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

const PERSON_SELECT = {
    id: true,
    email: true,
    name: true,
    roles: { select: { role: true } },
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

                const currentFlags = rolesToFlags(target.roles);

                // Real delta: only flags whose requested value actually differs from the
                // target's current value are "changes" — a present flag equal to the
                // current value is a no-op, not an authz-relevant change.
                const updateData: Partial<Record<RoleFlag, boolean>> = {};
                for (const field of ROLE_FLAGS) {
                    const val = requested[field];
                    if (val === undefined || val === currentFlags[field]) continue;
                    updateData[field] = val;
                }

                if (Object.keys(updateData).length === 0) {
                    // Every requested flag was already at its current value — nothing to
                    // change, nothing to audit.
                    return { user: { id: target.id, email: target.email, name: target.name, ...currentFlags } };
                }

                // The authority matrix (§4.3), the last-board-member guard, and the FOR
                // UPDATE lock they need all live in setRoleFlag now — this loop is pure
                // parsing/dispatch, one call per changed flag.
                for (const field of Object.keys(updateData) as RoleFlag[]) {
                    await setRoleFlag(tx, target, field, updateData[field]!, actor);
                }

                const oldData: Partial<Record<RoleFlag, boolean>> = {};
                for (const field of Object.keys(updateData) as RoleFlag[]) {
                    oldData[field] = currentFlags[field];
                }

                await tx.auditLog.create({
                    data: {
                        actorId: actor.id,
                        action: "EDIT",
                        tableName: "PersonRole",
                        affectedEntityId: targetUserId,
                        oldData,
                        newData: updateData,
                    },
                });

                const newFlags = { ...currentFlags, ...updateData };
                return { user: { id: target.id, email: target.email, name: target.name, ...newFlags } };
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
