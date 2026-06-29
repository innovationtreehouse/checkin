import type { Prisma } from '@/generated/prisma/client';

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
                dateOfBirth: true;
                householdId: true;
                phone: true;
                household: {
                    select: {
                        id: true;
                        emergencyContacts: {
                            select: {
                                id: true;
                                name: true;
                                phone: true;
                                relationship: true;
                            };
                        };
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
