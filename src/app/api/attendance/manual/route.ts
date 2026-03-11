/* eslint-disable @typescript-eslint/no-explicit-any */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { logBackendError } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as any).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const body = await req.json();
        const { arrived, departed } = body;

        if (!arrived) {
            return NextResponse.json({ error: "Arrival time is required" }, { status: 400 });
        }

        const arrivalTime = new Date(arrived);
        const departureTime = departed ? new Date(departed) : null;

        if (departureTime && departureTime <= arrivalTime) {
            return NextResponse.json({ error: "Departure time must be after arrival time" }, { status: 400 });
        }

        const eventId = await findAssociatedEventAt(userId, arrivalTime);

        const visit = await prisma.visit.create({
            data: {
                participantId: userId,
                arrived: arrivalTime,
                departed: departureTime,
                associatedEventId: eventId
            }
        });

        // If a departure time was provided, we process the checkout logic directly 
        // to handle any back-to-back event transitions.
        if (departureTime) {
             await processVisitCheckout(visit.id, departureTime);
        }

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "CREATE",
                tableName: "Visit",
                affectedEntityId: visit.id,
                newData: JSON.stringify({ arrived, departed, type: "manual_entry" })
            }
        });

        return NextResponse.json({ message: "Manual visit recorded successfully.", visit }, { status: 201 });
    } catch (error: any) {
        console.error("Manual Attendance POST Error:", error);
        await logBackendError(error, "POST /api/attendance/manual");
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
