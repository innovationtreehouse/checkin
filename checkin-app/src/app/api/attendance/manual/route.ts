import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { logBackendError } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = session.user.id;
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

        // Creating an open visit (no departure) is a read-modify-write on this
        // participant's visit state, just like /api/scan. Take the same
        // per-participant advisory xact lock and re-check for an existing open
        // visit before creating, so two concurrent manual submits — or a manual
        // submit racing a kiosk scan — can't leave two open visits for one
        // participant (checkout closes only one, the other lingers forever).
        const visit = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${Number(userId)})`;

            // Only an open visit carries dedup-able state; a closed one (departure
            // provided) is just a historical record, so multiple are fine.
            if (!departureTime) {
                const openVisit = await tx.visit.findFirst({
                    where: { participantId: userId, departed: null }
                });
                if (openVisit) return openVisit;
            }

            return await tx.visit.create({
                data: {
                    participantId: userId,
                    arrived: arrivalTime,
                    departed: departureTime,
                    associatedEventId: eventId
                }
            });
        }, {
            maxWait: 5000,
            timeout: 15000,
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
    } catch (error: unknown) {
        console.error("Manual Attendance POST Error:", error);
        await logBackendError(error, "POST /api/attendance/manual");
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
