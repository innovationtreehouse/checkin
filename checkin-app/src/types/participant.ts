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
    sysadmin: boolean;
    boardMember: boolean;
    keyholder: boolean;
    shopSteward: boolean;
    backgroundCheckReviewer: boolean;
    householdId?: number;
    householdLead?: boolean;
}

export interface BoardMember {
    id: number;
    name: string | null;
    email: string;
    phone: string | null;
}
