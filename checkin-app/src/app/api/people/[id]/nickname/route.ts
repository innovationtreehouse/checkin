import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { LIVE_PERSON } from "@/lib/person/filters";
import { nicknameWrite } from "@/lib/person/name";
import { apiError } from "@/lib/api-response";

// Badge printers set the name a person goes by. Operations is admitted alongside
// board/sysadmin because printing the ID badges is inside its reach (docs/rules/
// attendance-checkin.md) — this writes badge text, not an attendance record. A
// person edits their own via PATCH /api/profile, and a household lead edits their
// household's via PATCH /api/household/member.
export const PATCH = withAuth<{ params: Promise<{ id: string }> }>(
    { roles: ['isSysadmin', 'isBoardMember', 'isOperations'] },
    async (request: NextRequest, auth, { params }) => {
        if (auth.type !== 'session') return apiError("Unauthorized", 401);

        try {
            const id = parseInt((await params).id, 10);
            if (isNaN(id)) return apiError("Invalid person ID", 400);

            const body = await request.json();
            if (body.nickname === undefined) return apiError("Nickname is required", 400);
            const nickname = nicknameWrite(body.nickname);

            // A merged-away record has no badge to print, so it is not addressable here.
            const target = await prisma.person.findFirst({
                where: { id, ...LIVE_PERSON },
                select: { id: true },
            });
            if (!target) return apiError("Person not found", 404);

            const person = await prisma.person.update({
                where: { id },
                data: { nickname },
                select: { id: true, name: true, nickname: true },
            });

            await prisma.auditLog.create({
                data: {
                    actorId: auth.user.id,
                    action: "EDIT",
                    tableName: "Person",
                    affectedEntityId: id,
                    newData: person,
                },
            });

            return NextResponse.json({ person });
        } catch (error) {
            logger.error("Nickname PATCH Error:", error);
            return apiError("Failed to update nickname", 500);
        }
    }
);
