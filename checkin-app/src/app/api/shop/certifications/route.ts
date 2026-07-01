import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { Prisma } from '@/generated/prisma/client';
import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";

export const GET = withAuth({}, async (req, auth) => {
    // withAuth funnels the denied-household check (auth.ts) and rejects kiosk —
    // a raw getServerSession would let a board-denied member keep reading shop data.
    if (auth.type !== 'session') {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const session = { user: auth.user };

    try {
        const { searchParams } = new URL(req.url);
        const participantIdParam = searchParams.get('participantId');
        const toolIdParam = searchParams.get('toolId');
        const allParam = searchParams.get('all');

        // ?all=true returns every assignment — admin/board only
        if (allParam === 'true') {
            const isAuthorized = session.user?.isSysadmin || session.user?.isBoardMember;
            if (!isAuthorized) {
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            }
            const certifications = await prisma.toolStatus.findMany({
                orderBy: [{ tool: { name: 'asc' } }, { participant: { name: 'asc' } }],
                include: {
                    tool: true,
                    participant: { select: { id: true, name: true, email: true } },
                },
            });
            return NextResponse.json(certifications);
        }

        let targetUserId = session.user.id;

        // Certifier standing = holds MAY_CERTIFY_OTHERS on any tool — same derivation as
        // callerHoldsRole('certifier', ...) in src/security/access-resolvers.ts.
        const isCertifier = (session.user.toolStatuses ?? []).some(ts => ts.level === 'MAY_CERTIFY_OTHERS');
        const canReadOthers = session.user?.isSysadmin || session.user?.isBoardMember || isCertifier;

        if (participantIdParam) {
            targetUserId = parseInt(participantIdParam, 10);

            // Reading someone else's certifications requires admin/board or certifier
            // standing — mirrors the ?all=true gate above. Self-lookups stay open to anyone.
            if (targetUserId !== session.user.id && !canReadOthers) {
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            }
        }

        let whereClause: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};

        if (toolIdParam) {
            // The by-tool roster lists every certified member on a tool — the same
            // cross-member data the participant lookup protects, so gate it identically.
            // (Its only consumer, shop-ops ToolManagementPanel, is already staff/certifier
            // gated client-side; without this the roster was readable by any logged-in member.)
            if (!canReadOthers) {
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            }
            whereClause = { toolId: parseInt(toolIdParam, 10) };
        } else {
            // Looking up a specific person's certifications
            whereClause = { participantId: targetUserId };
        }

        const certifications = await prisma.toolStatus.findMany({
            where: whereClause,
            include: {
                tool: true,
                participant: toolIdParam ? { select: { id: true, name: true } } : false
            }
        });

        return NextResponse.json(certifications);
    } catch (error) {
        await logBackendError(error, "GET /api/shop/certifications");
        return NextResponse.json({ error: "Failed to fetch certifications" }, { status: 500 });
    }
});

// withAuth funnels the denied-household check at admission (closes GAP-1: this
// POST previously re-queried certifier status with no denied gate), then the
// certifier (MAY_CERTIFY_OTHERS) authorization runs as before.
export const POST = withAuth({}, async (req, auth) => {
    if (auth.type !== 'session') {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const session = { user: auth.user };

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
        const isSysAdminOrBoard = session.user?.isSysadmin || session.user?.isBoardMember;

        let hasCertifierPermission = isSysAdminOrBoard;

        if (!hasCertifierPermission) {
            // Check if user is a certifier for this specific tool
            const currentUserStatus = await prisma.toolStatus.findUnique({
                where: {
                    participantId_toolId: {
                        participantId: currentUserId,
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
            where: { participantId_toolId: { participantId: pId, toolId: tId } }
        });

        const upsertedCert = await prisma.toolStatus.upsert({
            where: {
                participantId_toolId: {
                    participantId: pId,
                    toolId: tId
                }
            },
            update: {
                level: level as 'BASIC' | 'DOF' | 'CERTIFIED' | 'INSTRUCTOR' | 'MAY_CERTIFY_OTHERS'
            },
            create: {
                participantId: pId,
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
                oldData: currentStatus ?? Prisma.JsonNull,
                newData: upsertedCert
            }
        });

        return NextResponse.json({ success: true, certification: upsertedCert });
    } catch (error: unknown) {
        await logBackendError(error, "POST /api/shop/certifications");
        return NextResponse.json({ error: "Failed to upsert certification" }, { status: 500 });
    }
});
