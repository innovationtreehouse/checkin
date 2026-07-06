/**
 * Visit with participant and event data, as returned by getFullAttendance.
 * PII-minimized (M1): email/googleId and role flags are deliberately NOT part of
 * this shape — getFullAttendance resolves the display name server-side and strips
 * them, so a consumer typed against this can't reach back for the raw
 * address/identifiers. Likewise dateOfBirth (personal tier) never ships: the
 * server computes the derived `isYouth` flag instead.
 *
 * `phone` and `household` (emergency contacts) are the personal-tier band for
 * front-desk staff: present for authenticated keyholder/board/sysadmin sessions,
 * absent on the anonymous kiosk wire (see GET /api/attendance).
 */
export interface AttendanceParticipant {
    id: number;
    name: string | null;
    isKeyholder: boolean;
    isYouth: boolean;
    householdId: number | null;
    phone?: string | null;
    household?: {
        id: number;
        emergencyContacts: {
            id: number;
            name: string;
            phone: string;
            relationship: string | null;
        }[];
    } | null;
}

export interface VisitWithDetails {
    id: number;
    personId: number;
    arrivedAt: Date | string;
    departedAt: Date | string | null;
    arrivedVia: string;
    departedVia: string | null;
    associatedEventId: number | null;
    participant: AttendanceParticipant;
    event: {
        id: number;
        name: string;
        startAt: Date | string;
        endAt: Date | string;
        program: { id: number; name: string } | null;
    } | null;
}

/**
 * Attendance counts breakdown.
 */
export interface AttendanceCounts {
    keyholders: number;
    volunteers: number;
    youth: number;
    total: number;
}

/**
 * Safety flags for the facility.
 */
export interface SafetyFlags {
    isLastKeyholder: boolean;
    isTwoDeepViolation: boolean;
}

/**
 * Full attendance response from getFullAttendance().
 */
export interface AttendanceData {
    attendance: VisitWithDetails[];
    counts: AttendanceCounts;
    safety: SafetyFlags;
}
