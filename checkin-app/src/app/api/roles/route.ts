import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";

type RoleFlag = "isSysadmin" | "isBoardMember" | "isKeyholder" | "isBackgroundCheckReviewer" | "isOperations";
const ROLE_FLAGS: RoleFlag[] = ["isSysadmin", "isBoardMember", "isKeyholder", "isBackgroundCheckReviewer", "isOperations"];

const ROLE_SELECT = {
    id: true,
    email: true,
    name: true,
    isSysadmin: true,
    isBoardMember: true,
    isKeyholder: true,
    isBackgroundCheckReviewer: true,
    isOperations: true,
} as const;

/** Thrown inside the tx when the actor's authority matrix denies a requested flag change. */
class RoleMatrixError extends Error {}
/** Thrown inside the tx when `targetUserId` does not resolve to a Person. */
class TargetNotFoundError extends Error {}
/** Thrown inside the tx when a change would remove the last remaining board member. */
class LastBoardMemberError extends Error {}

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
                    isSysadmin: true,
                    isBoardMember: true,
                    isKeyholder: true,
                    isBackgroundCheckReviewer: true,
                    isOperations: true,
                },
                orderBy: { name: "asc" },
            });
            // Don't leak dob (PII); expose only a youth flag for filtering.
            const people = rows.map(({ dateOfBirth, ...p }: (typeof rows)[number]) => ({
                ...p,
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
                // ponytail: FOR UPDATE over the whole board set — tiny table (a handful of
                // rows), so a coarse lock is fine; per-row locking buys nothing at this
                // scale. This serializes concurrent board-removals so two txns can't each
                // drop a different board member down to zero.
                await tx.$queryRaw`SELECT id FROM "Person" WHERE "isBoardMember" = true FOR UPDATE`;

                const target = await tx.person.findUnique({
                    where: { id: targetUserId },
                    select: ROLE_SELECT,
                });
                if (!target) throw new TargetNotFoundError();

                // Real delta: only flags whose requested value actually differs from the
                // target's current value are "changes" — a present flag equal to the
                // current value is a no-op, not an authz-relevant change.
                const updateData: Partial<Record<RoleFlag, boolean>> = {};
                for (const field of ROLE_FLAGS) {
                    const val = requested[field];
                    if (val === undefined || val === target[field]) continue;
                    updateData[field] = val;
                }

                // Per-flag matrix (§4.3). Board is the superset: grants/revokes all five,
                // including isSysadmin and removing isBoardMember (subject only to the
                // last-board guard below). A sysadmin-only actor (not board) may grant any
                // flag, including adding board, but may never remove board membership.
                for (const field of Object.keys(updateData) as RoleFlag[]) {
                    if (actor.isBoardMember) continue;
                    if (actor.isSysadmin) {
                        if (field === 'isBoardMember' && updateData[field] === false) {
                            throw new RoleMatrixError("Only board members can remove board membership");
                        }
                        continue;
                    }
                    // Unreachable: the withAuth gate above already 403'd anyone who is
                    // neither board nor sysadmin.
                    throw new RoleMatrixError("Forbidden");
                }

                const removingBoard = updateData.isBoardMember === false && target.isBoardMember === true;
                if (removingBoard) {
                    const boardCount = await tx.person.count({ where: { isBoardMember: true } });
                    if (boardCount <= 1) {
                        throw new LastBoardMemberError();
                    }
                }

                if (Object.keys(updateData).length === 0) {
                    // Every requested flag was already at its current value — nothing to
                    // change, nothing to audit.
                    return { user: target };
                }

                const updated = await tx.person.update({
                    where: { id: targetUserId },
                    data: updateData,
                    select: ROLE_SELECT,
                });

                const oldData: Partial<Record<RoleFlag, boolean>> = {};
                for (const field of Object.keys(updateData) as RoleFlag[]) {
                    oldData[field] = target[field];
                }

                await tx.auditLog.create({
                    data: {
                        actorId: actor.id,
                        action: "EDIT",
                        tableName: "Participant",
                        affectedEntityId: targetUserId,
                        oldData,
                        newData: updateData,
                    },
                });

                return { user: updated };
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
