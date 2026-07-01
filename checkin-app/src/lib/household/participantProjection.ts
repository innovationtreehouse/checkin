import type { Prisma } from "@/generated/prisma/client";

/**
 * Fields of a household peer's Participant row that are safe to send to any
 * other member of the same household (including minors) — i.e. what the
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
    isDeclaredAdult: true,
} satisfies Prisma.ParticipantSelect;
