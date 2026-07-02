import prisma from "@/lib/prisma";
import { isYouth } from "@/lib/time";

export async function getFullAttendance() {
    const activeVisits = await prisma.visit.findMany({
        where: { departedAt: null },
        include: {
            participant: {
                select: {
                    id: true,
                    // email is read only to resolve the name fallback below and never
                    // leaves this function (M1) — same pattern as the certifications
                    // grid (#329). googleId/isSysadmin aren't rendered anywhere downstream.
                    email: true,
                    name: true,
                    isKeyholder: true,
                    dateOfBirth: true,
                    householdId: true,
                    phone: true,
                    household: {
                        select: {
                            id: true,
                            // Only valid (non-member, complete) contacts, primary first.
                            emergencyContacts: {
                                where: { conflictParticipantId: null, name: { not: "" }, phone: { not: "" } },
                                orderBy: [{ priority: "asc" }, { id: "asc" }],
                                select: { id: true, name: true, phone: true, relationship: true },
                            },
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
        orderBy: { arrivedAt: "desc" },
    });

    // Pre-compute isYouth once per visit to avoid repeated calculations
    const youthMap = new Map<number, boolean>();
    for (const v of activeVisits) {
        youthMap.set(v.id, isYouth(v.participant.dateOfBirth));
    }

    const keyholderVisits = activeVisits.filter(v => v.participant.isKeyholder);
    const studentVisits = activeVisits.filter(v => youthMap.get(v.id)!);
    const volunteerVisits = activeVisits.filter(v => !v.participant.isKeyholder && !youthMap.get(v.id));

    const counts = {
        keyholders: keyholderVisits.length,
        volunteers: volunteerVisits.length,
        students: studentVisits.length,
        total: activeVisits.length,
    };

    const adultVisits = activeVisits.filter(v => !youthMap.get(v.id));
    const unaccompaniedStudents = studentVisits.filter(sv => {
        if (!sv.participant.householdId) return true;
        return !adultVisits.some(av => av.participant.householdId === sv.participant.householdId);
    });
    const safety = {
        isLastKeyholder: keyholderVisits.length === 1,
        isTwoDeepViolation: unaccompaniedStudents.length > 0 && adultVisits.length < 2,
    };

    // Drop email/googleId from the wire (M1): resolve the same name-or-email-prefix
    // fallback the UI already falls back to (`name || email.split("@")[0]`) here,
    // server-side, so `name` is always populated and the raw address never ships.
    const attendance = activeVisits.map(v => ({
        ...v,
        participant: {
            id: v.participant.id,
            name: v.participant.name?.trim() || v.participant.email?.split("@")[0] || null,
            isKeyholder: v.participant.isKeyholder,
            dateOfBirth: v.participant.dateOfBirth,
            householdId: v.participant.householdId,
            phone: v.participant.phone,
            household: v.participant.household,
        },
    }));

    return { attendance, counts, safety };
}

