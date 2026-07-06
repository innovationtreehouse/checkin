import prisma from "@/lib/prisma";
import { isYouth } from "@/lib/time";

export async function getFullAttendance() {
    const activeVisits = await prisma.visit.findMany({
        where: { departedAt: null },
        include: {
            person: {
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
            // Explicit select: the UI renders only the program-name badge. An
            // `include` would ship internal Event fields (attendanceConfirmedAt…)
            // and the whole Program row incl. leadMentorNotificationSettings
            // (personal tier) to every attendance viewer.
            event: {
                select: {
                    id: true,
                    name: true,
                    startAt: true,
                    endAt: true,
                    program: { select: { id: true, name: true } },
                }
            }
        },
        orderBy: { arrivedAt: "desc" },
    });

    // Pre-compute isYouth once per visit to avoid repeated calculations
    const youthMap = new Map<number, boolean>();
    for (const v of activeVisits) {
        youthMap.set(v.id, isYouth(v.person.dateOfBirth));
    }

    const keyholderVisits = activeVisits.filter(v => v.person.isKeyholder);
    const youthVisits = activeVisits.filter(v => youthMap.get(v.id)!);
    const volunteerVisits = activeVisits.filter(v => !v.person.isKeyholder && !youthMap.get(v.id));

    const counts = {
        keyholders: keyholderVisits.length,
        volunteers: volunteerVisits.length,
        youth: youthVisits.length,
        total: activeVisits.length,
    };

    const adultVisits = activeVisits.filter(v => !youthMap.get(v.id));
    const unaccompaniedYouth = youthVisits.filter(sv => {
        if (!sv.person.householdId) return true;
        return !adultVisits.some(av => av.person.householdId === sv.person.householdId);
    });
    const safety = {
        isLastKeyholder: keyholderVisits.length === 1,
        isTwoDeepViolation: unaccompaniedYouth.length > 0 && adultVisits.length < 2,
    };

    // Drop email/googleId from the wire (M1): resolve the same name-or-email-prefix
    // fallback the UI already falls back to (`name || email.split("@")[0]`) here,
    // server-side, so `name` is always populated and the raw address never ships.
    // Likewise dateOfBirth (personal tier) never ships — the UI only ever needs
    // the derived isYouth flag, which is computed here. Strip the raw included
    // `person` out of the spread and re-emit a sanitized DTO under the unchanged
    // wire key `participant` (API contract).
    const attendance = activeVisits.map(({ person, ...v }) => ({
        ...v,
        participant: {
            id: person.id,
            name: person.name?.trim() || person.email?.split("@")[0] || null,
            isKeyholder: person.isKeyholder,
            isYouth: youthMap.get(v.id)!,
            householdId: person.householdId,
            phone: person.phone,
            household: person.household,
        },
    }));

    return { attendance, counts, safety };
}

