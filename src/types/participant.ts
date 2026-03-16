/**
 * Shared session user type — matches the shape stored in NextAuth session.
 * Fields map 1:1 to Prisma Participant model role booleans.
 */
export interface SessionUser {
    id: number;
    email: string;
    name?: string;
    sysadmin: boolean;
    boardMember: boolean;
    keyholder: boolean;
    shopSteward: boolean;
    householdId?: number;
    householdLead?: boolean;
}

export interface BoardMember {
    id: number;
    name: string | null;
    email: string;
    phone: string | null;
}
