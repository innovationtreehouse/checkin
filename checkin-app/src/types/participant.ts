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
    isOperations: boolean;
    householdId?: number;
    householdLead?: boolean;
    // Shop tool certifications carried on the session (set by the jwt/session
    // callbacks). level === 'MAY_CERTIFY_OTHERS' marks a certifier.
    toolStatuses?: { toolId: number; level: string }[];
    // Google hosted-domain + email_verified claims (see lib/config.ts ORG_DOMAIN) —
    // read by the ops-stg access gate (authenticateRequest/resolveAccess).
    hd?: string | null;
    emailVerified?: boolean;
    // ops-stg access gate escape hatch — sysadmin-settable only, NOT one of the
    // five role flags above. See lib/config.ts isStagingAccessAllowed.
    canAccessStaging?: boolean;
}

export interface BoardMember {
    id: number;
    name: string | null;
    email: string;
    phone: string | null;
}
