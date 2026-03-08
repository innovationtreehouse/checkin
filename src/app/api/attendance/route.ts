import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";
import { getKioskPublicKey, verifyKioskSignature } from "@/lib/verify-kiosk";

function isStudentByDob(dob: Date | string | null | undefined): boolean {
    if (!dob) return false;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age < 18;
}

export async function GET(req: NextRequest) {
    try {
        // Determine caller identity
        const session = await getServerSession(authOptions);
        const user = session?.user as any;
        const hasKioskHeaders = req.headers.get("x-kiosk-signature");
        const pubKey = getKioskPublicKey();

        let isKiosk = false;

        if (!session && pubKey && hasKioskHeaders) {
            // Kiosk request — verify signature
            const result = verifyKioskSignature(
                "GET",
                "/api/attendance",
                "",
                req.headers.get("x-kiosk-timestamp"),
                req.headers.get("x-kiosk-signature"),
                pubKey
            );
            if (!result.ok) {
                return NextResponse.json({ error: result.error }, { status: result.status });
            }
            isKiosk = true;
        } else if (!session && pubKey) {
            // No session and no kiosk headers — reject
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        } else if (!session && !pubKey) {
            // Dev mode: no pubKey configured, treat as kiosk (allow all)
            isKiosk = true;
        }

        // Fetch all active visits (server always needs the full picture)
        const activeVisits = await prisma.visit.findMany({
            where: {
                departed: null,
            },
            include: {
                participant: {
                    select: {
                        id: true,
                        googleId: true,
                        email: true,
                        name: true,
                        keyholder: true,
                        sysadmin: true,
                        dob: true,
                        householdId: true
                    },
                },
            },
            orderBy: {
                arrived: "desc",
            },
        });

        // Compute category counts
        const keyholderVisits = activeVisits.filter(v => v.participant.keyholder);
        const studentVisits = activeVisits.filter(v => isStudentByDob(v.participant.dob));
        const volunteerVisits = activeVisits.filter(v => !v.participant.keyholder && !isStudentByDob(v.participant.dob));

        const counts = {
            keyholders: keyholderVisits.length,
            volunteers: volunteerVisits.length,
            students: studentVisits.length,
            total: activeVisits.length,
        };

        // Compute safety flags (needed for all access levels)
        const unaccompaniedStudents = studentVisits.filter(sv => {
            if (!sv.participant.householdId) return true;
            const adultVisits = activeVisits.filter(v => !isStudentByDob(v.participant.dob));
            return !adultVisits.some(av => av.participant.householdId === sv.participant.householdId);
        });
        const adultsPresent = activeVisits.filter(v => !isStudentByDob(v.participant.dob));
        const safety = {
            isLastKeyholder: keyholderVisits.length === 1,
            isTwoDeepViolation: unaccompaniedStudents.length > 0 && adultsPresent.length < 2,
        };

        // Determine access level
        const isAdmin = isKiosk || user?.sysadmin || user?.boardMember || user?.keyholder;

        if (isAdmin) {
            // Full access: return all visits + counts
            return NextResponse.json({
                access: "full",
                attendance: activeVisits,
                counts,
                safety,
            });
        }

        // Limited access: counts + household members + self only
        const selfVisit = user ? activeVisits.find(v => v.participant.id === Number(user.id)) || null : null;
        const householdVisits = (user?.householdId)
            ? activeVisits.filter(v => v.participant.householdId === user.householdId)
            : [];

        return NextResponse.json({
            access: "limited",
            counts,
            safety,
            self: selfVisit,
            household: householdVisits,
        });
    } catch (error) {
        console.error("Attendance fetch error:", error);
        return NextResponse.json(
            { error: "Internal Server Error while fetching attendance." },
            { status: 500 }
        );
    }
}

export async function DELETE(req: Request) {
    const session = await getServerSession(authOptions);
    const user = session?.user as any;

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { visitId } = body;

        if (!visitId) {
            return NextResponse.json({ error: "visitId is required" }, { status: 400 });
        }

        const visit = await prisma.visit.findUnique({
            where: { id: visitId },
            include: { participant: true }
        });

        if (!visit) {
            return NextResponse.json({ error: "Visit not found" }, { status: 404 });
        }

        // Check permissions:
        // 1. User checking out themselves
        // 2. User is the household lead checking out a family member
        // 3. User is an admin (sysadmin, keyholder, board member)
        const isSelf = visit.participantId === Number(user.id);
        const isHouseholdCheckOut = Boolean(user.householdId && visit.participant.householdId === user.householdId && user.householdLead);
        const isAdmin = user.sysadmin || user.keyholder || user.boardMember;

        if (!isSelf && !isHouseholdCheckOut && !isAdmin) {
            return NextResponse.json({ error: "Forbidden: You are not authorized to check out this user." }, { status: 403 });
        }

        const updatedVisit = await prisma.visit.update({
            where: { id: visitId },
            data: { departed: new Date() }
        });

        return NextResponse.json({ success: true, visit: updatedVisit });
    } catch (error) {
        console.error("Force checkout error:", error);
        return NextResponse.json({ error: "Failed to force checkout" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    const user = session?.user as any;

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isAdmin = user.sysadmin || user.keyholder || user.boardMember;

    try {
        const body = await req.json();
        const { type, message, participantId } = body;

        // Manual Check-in explicitly via the Dashboard
        if (type === 'MANUAL_CHECKIN') {
            if (!participantId) {
                return NextResponse.json({ error: "participantId is required" }, { status: 400 });
            }

            // Verify participant exists
            const participant = await prisma.participant.findUnique({
                where: { id: participantId }
            });

            if (!participant) {
                return NextResponse.json({ error: "Participant not found" }, { status: 404 });
            }

            // Check Permissions
            const isSelf = participant.id === Number(user.id);
            const isHouseholdCheckIn = Boolean(user.householdId && participant.householdId === user.householdId && user.householdLead);
            if (!isSelf && !isHouseholdCheckIn && !isAdmin) {
                return NextResponse.json({ error: "Forbidden: You are not authorized to check in this user." }, { status: 403 });
            }

            // Verify they aren't already checked in
            const activeVisit = await prisma.visit.findFirst({
                where: {
                    participantId: participant.id,
                    departed: null
                }
            });

            if (activeVisit) {
                return NextResponse.json({ error: "User is already checked in" }, { status: 400 });
            }

            const newVisit = await prisma.visit.create({
                data: {
                    participantId: participant.id,
                    arrived: new Date()
                }
            });

            return NextResponse.json({ success: true, visit: newVisit });
        }

        if (type === 'TWO_DEEP_VIOLATION') {
            // Debounce check: See if we already sent a notification recently (within 5 minutes)
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const recentLog = await prisma.auditLog.findFirst({
                where: {
                    tableName: 'SYSTEM_NOTIFY',
                    action: 'CREATE',
                    time: { gte: fiveMinutesAgo }
                }
            });

            if (recentLog) {
                return NextResponse.json({ success: false, message: "Notification already sent recently." });
            }

            // Find all board members
            const boardMembers = await prisma.participant.findMany({
                where: { boardMember: true },
                select: { email: true, name: true }
            });

            // Log that we sent the notification to prevent spam from multiple kiosks
            await prisma.auditLog.create({
                data: {
                    actorId: 0, // System actor
                    action: 'CREATE',
                    tableName: 'SYSTEM_NOTIFY',
                    affectedEntityId: 0,
                    newData: { message: `Sent Two-Deep warning to ${boardMembers.length} board member(s).` }
                } as any
            });

            // In a real app, integrate Resend/SendGrid here using boardMembers.map(m => m.email)
            console.log("CRITICAL NOTIFICATION TO BOARD MEMBERS:", boardMembers.map(m => m.email).join(', '));
            console.log("Message:", message);

            return NextResponse.json({ success: true, notified: boardMembers.length });
        }

        return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
    } catch (error) {
        console.error("Notification error:", error);
        return NextResponse.json({ error: "Failed to process notification" }, { status: 500 });
    }
}
