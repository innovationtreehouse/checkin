/**
 * Shared session user type — matches the shape stored in NextAuth session.
 * Fields map 1:1 to Prisma Participant model role booleans.
 */
export interface SessionUser {
    id: number;
    email: string;
    name?: string;
    // Household membership is DENIED — login blocked; role flags below are forced false.
    denied?: boolean;
    isSysadmin: boolean;
    isBoardMember: boolean;
    isKeyholder: boolean;
    isBackgroundCheckReviewer: boolean;
    householdId?: number;
    householdLead?: boolean;
    // Shop tool certifications carried on the session (set by the jwt/session
    // callbacks). level === 'MAY_CERTIFY_OTHERS' marks a certifier.
    toolStatuses?: { toolId: number; level: string }[];
}

export interface BoardMember {
    id: number;
    name: string | null;
    email: string;
    phone: string | null;
}
