import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";
import { ApiResponseError, handler, badRequest, forbidden, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/shop/tools', async ({ auth }) => {
    try {
        if (auth.type !== 'session') throw unauthorized();

        const tools = await prisma.tool.findMany({
            orderBy: { name: 'asc' },
            include: {
                _count: {
                    select: { toolStatuses: true }
                }
            }
        });

        return { Tool: tools };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "GET /api/shop/tools");
        throw err;
    }
});

export const POST = handler('POST /api/shop/tools', async ({ req, auth }) => {
    try {
        if (auth.type !== 'session') throw unauthorized();

        const isAuthorized = auth.user.sysadmin || auth.user.boardMember || auth.user.shopSteward;

        if (!isAuthorized) {
            throw forbidden("Forbidden: Only admins, board members, and shop stewards can create tools");
        }

        const body = await req.json();
        const { name, safetyGuide } = body;

        if (!name) {
            throw badRequest("Tool name is required");
        }

        const newTool = await prisma.tool.create({
            data: {
                name,
                safetyGuide: safetyGuide || null
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: 'CREATE',
                tableName: 'Tool',
                affectedEntityId: newTool.id,
                newData: JSON.stringify(newTool)
            }
        });

        return { Tool: newTool };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "POST /api/shop/tools");
        throw err;
    }
});
