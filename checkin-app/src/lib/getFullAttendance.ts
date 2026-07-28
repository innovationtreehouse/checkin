import prisma from "@/lib/prisma";
import { isYouth } from "@/lib/time";
import { LIVE_PERSON } from "@/lib/person/filters";

/**
 * Current-attendance feed.
 *
 * Two payload shapes, chosen by caller type:
 *
 * - Default (a signed-in privileged human — keyholder/board/sysadmin): the full
 *   roster including `dateOfBirth`, `phone` and the household's emergency
 *   contacts. That is the deliberate pickup/safety grant behind the keyholder
 *   view (`registry.ts` grants `keyholders:personal`), rendered by the
 *   emergency-contact modal on /attendance/current.
 *
 * - `{ kiosk: true }` (a signature-verified kiosk): a display-only roster —
 *   id, display name, isKeyholder, isYouth, arrival time and the program badge.
 *   The kiosk is an UNATTENDED device in a public room, and it forwards whatever
 *   it receives into an iframe with a wildcard postMessage origin
 *   (`client/client.py`), so no `personal`/`pii` field may reach it. It renders
 *   none of them: phone and the emergency-contact modal are both gated on
 *   `!isKioskMode` in /attendance/current/page.tsx. Emergency contacts aren't
 *   even fetched on this path. Same minimization as the sibling kiosk
 *   certifications grid (#329).
 *
 * `counts`/`safety` are identical either way — they are aggregates.
 */
export async function getFullAttendance(opts: { kiosk?: boolean } = {}) {
    const kiosk = opts.kiosk === true;

    const activeVisits = await prisma.visit.findMany({
        where: { departedAt: null, person: LIVE_PERSON },
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
                    // dateOfBirth is read on both paths (it computes isYouth / the
                    // counts) but only SHIPS on the privileged path.
                    dateOfBirth: true,
                    // Adults 26+ have their DoB deliberately stripped (#1165) and
                    // carry this flag instead — the safety calc must honor it.
                    isDeclaredAdult: true,
                    householdId: true,
                    phone: true,
                    household: kiosk ? false : {
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

    // Pre-compute isYouth once per visit to avoid repeated calculations.
    // This map feeds the two-deep safety calc: a declared adult (null DoB is
    // the NORMAL state for 26+, #1165) counts as an adult; only a truly
    // unknown person — no DoB, not declared — fails closed as youth (#300),
    // never as a supervising adult.
    const youthMap = new Map<number, boolean>();
    for (const v of activeVisits) {
        youthMap.set(v.id, v.person.isDeclaredAdult
            ? false
            : isYouth(v.person.dateOfBirth, { unknownIs: 'youth' }));
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
    // Strip the raw included `person` (carries email) out of the spread and re-emit
    // a sanitized DTO under the unchanged wire key `participant` (API contract).
    const attendance = activeVisits.map(({ person, ...v }) => {
        const displayName = person.name?.trim() || person.email?.split("@")[0] || null;

        if (kiosk) {
            // Display-only projection — see the header comment. The visit row itself
            // is rebuilt field by field rather than spread, so nothing new added to
            // Visit/Program later leaks onto the kiosk by default.
            return {
                id: v.id,
                arrivedAt: v.arrivedAt,
                participant: {
                    id: person.id,
                    name: displayName,
                    isKeyholder: person.isKeyholder,
                    // The kiosk splits the board into keyholder/volunteer/youth
                    // columns. It gets the classification, not the birth date.
                    isYouth: youthMap.get(v.id)!,
                },
                event: v.event ? { program: v.event.program ? { id: v.event.program.id, name: v.event.program.name } : null } : null,
            };
        }

        return {
            ...v,
            participant: {
                id: person.id,
                name: displayName,
                isKeyholder: person.isKeyholder,
                isYouth: youthMap.get(v.id)!,
                dateOfBirth: person.dateOfBirth,
                householdId: person.householdId,
                phone: person.phone,
                household: person.household,
            },
        };
    });

    return { attendance, counts, safety };
}
