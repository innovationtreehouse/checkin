import type { SessionUser } from './participant';

/**
 * Business role field names from the Participant model.
 * Used by withAuth() to check roles directly via user[role] === true.
 */
export type BusinessRole = 'isSysadmin' | 'isBoardMember' | 'isKeyholder' | 'isBackgroundCheckReviewer';

/**
 * Result of authenticating a request — either kiosk, session, or unauthenticated.
 */
export type AuthResult =
    | { type: 'kiosk' }
    | { type: 'session'; user: SessionUser }
    | { type: 'unauthenticated' };
