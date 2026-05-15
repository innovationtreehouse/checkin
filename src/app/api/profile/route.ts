import prisma from "@/lib/prisma";
import { handler, notFound, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/profile', async ({ auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const profile = await prisma.participant.findUnique({
        where: { id: auth.user.id },
        include: {
            visits: {
                orderBy: { arrived: 'desc' },
                take: 50,
                include: { event: true },
            },
        },
    });
    if (!profile) throw notFound('Profile not found');
    return { Participant: profile };
});

export const PATCH = handler('PATCH /api/profile', async ({ req, auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const body = await req.json();
    const { name, phone, dob, homeAddress, notificationSettings } = body;

    const updatedProfile = await prisma.participant.update({
        where: { id: userId },
        data: {
            name: name !== undefined ? name : undefined,
            phone: phone !== undefined ? phone : undefined,
            dob: dob ? new Date(dob) : undefined,
            homeAddress: homeAddress !== undefined ? homeAddress : undefined,
            notificationSettings: notificationSettings !== undefined ? notificationSettings : undefined,
        },
    });

    await prisma.auditLog.create({
        data: {
            actorId: userId,
            action: "EDIT",
            tableName: "Participant",
            affectedEntityId: userId,
            newData: JSON.stringify({
                name: updatedProfile.name,
                email: updatedProfile.email,
                phone: updatedProfile.phone,
                dob: updatedProfile.dob,
                homeAddress: updatedProfile.homeAddress,
                notificationSettings: updatedProfile.notificationSettings,
            }),
        },
    });

    return { Participant: updatedProfile };
});
