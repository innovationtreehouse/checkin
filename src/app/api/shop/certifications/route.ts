import { Prisma } from '@prisma/client';
import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";
import { ApiResponseError, handler, badRequest, forbidden, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/shop/certifications', async ({ req, auth }) => {
    try {
        if (auth.type !== 'session') throw unauthorized();

        const { searchParams } = new URL(req.url);
        const participantIdParam = searchParams.get('participantId');
        const toolIdParam = searchParams.get('toolId');

        let targetUserId = auth.user.id;

        if (participantIdParam) {
            targetUserId = parseInt(participantIdParam, 10);
        }

        let whereClause: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};

        if (toolIdParam) {
            whereClause = { toolId: parseInt(toolIdParam, 10) };
        } else {
            whereClause = { userId: targetUserId };
        }

        const certifications = await prisma.toolStatus.findMany({
            where: whereClause,
            include: {
                tool: true,
                user: toolIdParam ? { select: { id: true, name: true, email: true } } : false
            }
        });

        return { ToolStatus: certifications };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "GET /api/shop/certifications");
        throw err;
    }
});

export const POST = handler('POST /api/shop/certifications', async ({ req, auth }) => {
    try {
        if (auth.type !== 'session') throw unauthorized();

        const body = await req.json();
        const { participantId, toolId, level } = body;

        if (!participantId || !toolId || !level) {
            throw badRequest("Missing required fields");
        }

        const validLevels = ["BASIC", "DOF", "CERTIFIED", "MAY_CERTIFY_OTHERS"];
        if (!validLevels.includes(level)) {
            throw badRequest("Invalid certification level");
        }

        const currentUserId = auth.user.id;
        const isSysAdminOrBoard = auth.user.sysadmin || auth.user.boardMember;

        let hasCertifierPermission = !!isSysAdminOrBoard;

        if (!hasCertifierPermission) {
            const currentUserStatus = await prisma.toolStatus.findUnique({
                where: {
                    userId_toolId: {
                        userId: currentUserId,
                        toolId: parseInt(toolId, 10)
                    }
                }
            });

            if (currentUserStatus && currentUserStatus.level === "MAY_CERTIFY_OTHERS") {
                hasCertifierPermission = true;
            }
        }

        if (!hasCertifierPermission) {
            throw forbidden("Forbidden: You are not authorized to certify users on this tool");
        }

        const tId = parseInt(toolId, 10);
        const pId = parseInt(participantId, 10);

        const currentStatus = await prisma.toolStatus.findUnique({
            where: { userId_toolId: { userId: pId, toolId: tId } }
        });

        const upsertedCert = await prisma.toolStatus.upsert({
            where: {
                userId_toolId: {
                    userId: pId,
                    toolId: tId
                }
            },
            update: {
                level: level as 'BASIC' | 'DOF' | 'CERTIFIED' | 'MAY_CERTIFY_OTHERS'
            },
            create: {
                userId: pId,
                toolId: tId,
                level: level as 'BASIC' | 'DOF' | 'CERTIFIED' | 'MAY_CERTIFY_OTHERS'
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: currentUserId,
                action: currentStatus ? 'EDIT' : 'CREATE',
                tableName: 'ToolStatus',
                affectedEntityId: pId,
                secondaryAffectedEntity: tId,
                oldData: currentStatus ? JSON.stringify(currentStatus) : Prisma.JsonNull,
                newData: JSON.stringify(upsertedCert)
            }
        });

        return { ToolStatus: upsertedCert };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "POST /api/shop/certifications");
        throw err;
    }
});
