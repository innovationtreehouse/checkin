import prisma from "@/lib/prisma";
import { isMinor } from "@/lib/time";

export async function getFullAttendance() {
    const activeVisits = await prisma.visit.findMany({
        where: { departed: null },
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
                    householdId: true,
                    phone: true,
                    household: {
                        select: {
                            id: true,
                            emergencyContactName: true,
                            emergencyContactPhone: true,
                        }
                    }
                },
            },
            event: {
                include: {
                    program: true
                }
            }
        },
        orderBy: { arrived: "desc" },
    });

    // Pre-compute isMinor once per visit to avoid repeated calculations
    const minorMap = new Map<number, boolean>();
    for (const v of activeVisits) {
        minorMap.set(v.id, isMinor(v.participant.dob));
    }

    const keyholderVisits = activeVisits.filter(v => v.participant.keyholder);
    const studentVisits = activeVisits.filter(v => minorMap.get(v.id)!);
    const volunteerVisits = activeVisits.filter(v => !v.participant.keyholder && !minorMap.get(v.id));

    const counts = {
        keyholders: keyholderVisits.length,
        volunteers: volunteerVisits.length,
        students: studentVisits.length,
        total: activeVisits.length,
    };

    const adultVisits = activeVisits.filter(v => !minorMap.get(v.id));
    const unaccompaniedStudents = studentVisits.filter(sv => {
        if (!sv.participant.householdId) return true;
        return !adultVisits.some(av => av.participant.householdId === sv.participant.householdId);
    });
    const safety = {
        isLastKeyholder: keyholderVisits.length === 1,
        isTwoDeepViolation: unaccompaniedStudents.length > 0 && adultVisits.length < 2,
    };

    return { attendance: activeVisits, counts, safety };
}

