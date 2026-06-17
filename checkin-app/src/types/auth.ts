import type { SessionUser } from './participant';

/**
 * Business role field names from the Participant model.
 * Used by withAuth() to check roles directly via user[role] === true.
 */
export type BusinessRole = 'sysadmin' | 'boardMember' | 'keyholder' | 'backgroundCheckReviewer';

/**
 * Result of authenticating a request — either kiosk, session, or unauthenticated.
 */
export type AuthResult =
    | { type: 'kiosk' }
    | { type: 'session'; user: SessionUser }
    | { type: 'unauthenticated' };
