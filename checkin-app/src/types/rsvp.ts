export const RSVP_STATUSES = ["ATTENDING", "NOT_ATTENDING", "NO_RESPONSE", "MAYBE"] as const;
export type RSVPStatus = typeof RSVP_STATUSES[number];
