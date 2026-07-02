import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { handler, notFound, unauthorized } from "@/security/handler";
import { isValidPhone, formatPhone, PHONE_ERROR } from "@/lib/phone";
import { isYouth } from "@/lib/time";

export const GET = handler('GET /api/profile', async ({ auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const profile = await prisma.person.findUnique({
        where: { id: auth.user.id },
        include: {
            visits: {
                orderBy: { arrivedAt: 'desc' },
                take: 50,
                include: { event: true },
            },
        },
    });
    if (!profile) throw notFound('Profile not found');
    return { Person: profile };
});

export const PATCH = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            const me = await prisma.person.findUnique({
                where: { id: userId },
                select: { dateOfBirth: true },
            });
            if (isYouth(me?.dateOfBirth)) {
                return NextResponse.json({ error: "Youth profiles are read-only." }, { status: 403 });
            }

            const body = await req.json();
            const { name, phone, dob, notificationSettings } = body;

            if (phone !== undefined && phone !== "" && !isValidPhone(phone)) {
                return NextResponse.json({ error: PHONE_ERROR }, { status: 400 });
            }

            const updatedProfile = await prisma.person.update({
                where: { id: userId },
                data: {
                    name: name !== undefined ? name : undefined,
                    phone: phone !== undefined ? (phone === "" ? null : formatPhone(phone)) : undefined,
                    dateOfBirth: dob ? new Date(dob) : undefined,
                    notificationSettings: notificationSettings !== undefined ? notificationSettings : undefined,
                },
                select: {
                    name: true,
                    email: true,
                    phone: true,
                    dateOfBirth: true,
                    notificationSettings: true,
                }
            });

            await prisma.auditLog.create({
                data: {
                    actorId: userId,
                    action: "EDIT",
                    tableName: "Participant",
                    affectedEntityId: userId,
                    newData: updatedProfile,
                }
            });

            return NextResponse.json({ profile: updatedProfile }, { status: 200 });

        } catch (error) {
            console.error("Profile PATCH Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
