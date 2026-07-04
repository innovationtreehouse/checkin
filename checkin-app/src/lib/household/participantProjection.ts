import type { Prisma } from "@/generated/prisma/client";

/**
 * Fields of a household peer's Person row that are safe to send to any
 * other member of the same household (including youth) — i.e. what the
 * my-household member cards and the program-enrollment picker actually
 * render. Excludes INTERNAL-tier fields (role flags, googleId, emailVerified,
 * lastBackgroundCheck, waiverSignedBy, notificationSettings, ...) that a
 * household peer has no business seeing (M2).
 */
export const HOUSEHOLD_PEER_SELECT = {
    id: true,
    name: true,
    email: true,
    phone: true,
    dateOfBirth: true,
    // Deliberate exception: isDeclaredAdult is @sensitivity:internal, but a household
    // peer legitimately needs it to render each member's age badge / pre-fill the edit
    // form (my-household). It's an age-status flag, not a role/audit/security flag.
    isDeclaredAdult: true,
    // Collected per-person at membership intake; household peers view/edit it on
    // the my-household cards. Same @sensitivity:personal tier as name/email/phone.
    allergies: true,
} satisfies Prisma.PersonSelect;
