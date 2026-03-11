/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as any).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as any).id;

        const profile = await prisma.participant.findUnique({
            where: { id: userId },
            select: {
                name: true,
                email: true,
                phone: true,
                dob: true,
                homeAddress: true,
                notificationSettings: true,
                visits: {
                    orderBy: { arrived: 'desc' },
                    take: 50,
                    select: {
                        id: true,
                        arrived: true,
                        departed: true,
                        event: { select: { name: true } }
                    }
                }
            }
        });
        if (!profile) {
            return NextResponse.json({ error: "Profile not found" }, { status: 404 });
        }

        return NextResponse.json({ profile }, { status: 200 });
    } catch (error: any) {
        console.error("Profile GET Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as any).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const body = await req.json();
        const { name, phone, dob, homeAddress, notificationSettings } = body;

        // Perform basic validation if necessary
        const updatedProfile = await prisma.participant.update({
            where: { id: userId },
            data: {
                name: name !== undefined ? name : undefined,
                phone: phone !== undefined ? phone : undefined,
                dob: dob ? new Date(dob) : undefined,
                homeAddress: homeAddress !== undefined ? homeAddress : undefined,
                notificationSettings: notificationSettings !== undefined ? notificationSettings : undefined,
            },
            select: {
                name: true,
                email: true,
                phone: true,
                dob: true,
                homeAddress: true,
                notificationSettings: true,
            }
        });

        // Log the change in the audit trail
        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "EDIT",
                tableName: "Participant",
                affectedEntityId: userId,
                newData: JSON.stringify(updatedProfile),
            }
        });

        return NextResponse.json({ profile: updatedProfile }, { status: 200 });

    } catch (error: any) {
        console.error("Profile PATCH Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
