import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import { Prisma } from '@/generated/prisma/client';
import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(req.url);
        const participantIdParam = searchParams.get('participantId');
        const toolIdParam = searchParams.get('toolId');
        const allParam = searchParams.get('all');

        // ?all=true returns every assignment — admin/board only
        if (allParam === 'true') {
            const isAuthorized = session.user?.sysadmin || session.user?.boardMember;
            if (!isAuthorized) {
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            }
            const certifications = await prisma.toolStatus.findMany({
                orderBy: [{ tool: { name: 'asc' } }, { user: { name: 'asc' } }],
                include: {
                    tool: true,
                    user: { select: { id: true, name: true, email: true } },
                },
            });
            return NextResponse.json(certifications);
        }

        let targetUserId = session.user.id;

        if (participantIdParam) {
            targetUserId = parseInt(participantIdParam, 10);
            // IDOR guard: a member may only read their own certs. Privileged roles
            // (same gate as ?all=true) may read anyone's. Certifier is per-tool, not a
            // session flag, so it isn't a privileged role here.
            const isPrivileged = session.user?.sysadmin || session.user?.boardMember;
            if (targetUserId !== session.user.id && !isPrivileged) {
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            }
        }

        let whereClause: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};

        if (toolIdParam) {
            // If checking who is certified on a tool
            whereClause = { toolId: parseInt(toolIdParam, 10) };
        } else {
            // Looking up a specific person's certifications
            whereClause = { userId: targetUserId };
        }

        const certifications = await prisma.toolStatus.findMany({
            where: whereClause,
            include: {
                tool: true,
                user: toolIdParam ? { select: { id: true, name: true, email: true } } : false
            }
        });

        return NextResponse.json(certifications);
    } catch (error) {
        await logBackendError(error, "GET /api/shop/certifications");
        return NextResponse.json({ error: "Failed to fetch certifications" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { participantId, toolId, level } = body;

        if (!participantId || !toolId || !level) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const validLevels = ["BASIC", "DOF", "CERTIFIED", "INSTRUCTOR", "MAY_CERTIFY_OTHERS"];
        if (!validLevels.includes(level)) {
            return NextResponse.json({ error: "Invalid certification level" }, { status: 400 });
        }

        const currentUserId = session.user.id;
        const isSysAdminOrBoard = session.user?.sysadmin || session.user?.boardMember;

        let hasCertifierPermission = isSysAdminOrBoard;

        if (!hasCertifierPermission) {
            // Check if user is a certifier for this specific tool
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
            return NextResponse.json({ error: "Forbidden: You are not authorized to certify users on this tool" }, { status: 403 });
        }

        // Only sysadmins/board may promote a user to MAY_CERTIFY_OTHERS. A tool
        // certifier can change certification status up to (but not including)
        // MAY_CERTIFY_OTHERS — they cannot mint new certifiers.
        if (level === "MAY_CERTIFY_OTHERS" && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Only admins and board members can grant the Certifier level" }, { status: 403 });
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
                level: level as 'BASIC' | 'DOF' | 'CERTIFIED' | 'INSTRUCTOR' | 'MAY_CERTIFY_OTHERS'
            },
            create: {
                userId: pId,
                toolId: tId,
                level: level as 'BASIC' | 'DOF' | 'CERTIFIED' | 'INSTRUCTOR' | 'MAY_CERTIFY_OTHERS'
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

        return NextResponse.json({ success: true, certification: upsertedCert });
    } catch (error: unknown) {
        await logBackendError(error, "POST /api/shop/certifications");
        return NextResponse.json({ error: "Failed to upsert certification" }, { status: 500 });
    }
}
