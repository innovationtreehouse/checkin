import type { Prisma } from "@/generated/prisma/client";

/**
 * The ONE definition of "authorized at the front desk right now": the adult has at
 * least one APPROVED review. Renewal leaves the prior approval APPROVED, so a
 * TrustedAdult routinely carries several — authorization is a property of the ADULT,
 * not of a single review. /operational, the deny notice, and the expiry sweep all read it.
 */
export const AUTHORIZED_REVIEW: Prisma.TrustedAdultReviewWhereInput = { status: "APPROVED" };
