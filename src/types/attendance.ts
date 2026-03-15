import type { Prisma } from '@prisma/client';

/**
 * Visit with included participant and event data, as returned by getFullAttendance.
 */
export type VisitWithDetails = Prisma.VisitGetPayload<{
    include: {
        participant: {
            select: {
                id: true;
                googleId: true;
                email: true;
                name: true;
                keyholder: true;
                sysadmin: true;
                dob: true;
                householdId: true;
                phone: true;
                household: {
                    select: {
                        emergencyContactName: true;
                        emergencyContactPhone: true;
                    };
                };
            };
        };
        event: {
            include: {
                program: true;
            };
        };
    };
}>;

/**
 * Attendance counts breakdown.
 */
export interface AttendanceCounts {
    keyholders: number;
    volunteers: number;
    students: number;
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
