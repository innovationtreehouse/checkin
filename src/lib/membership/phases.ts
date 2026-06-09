import type { MembershipProcessStatus } from "@prisma/client";

/**
 * Applicant-facing phases of an INITIAL membership application, in order.
 * Drives the left-rail flow diagram (MembershipFlowStepper) and lets the API
 * report "where am I?" without leaking internal mechanics. BLOCKED is an
 * off-track error state handled separately (never shown as a step).
 */
export interface IntakePhase {
    status: MembershipProcessStatus;
    label: string;
    description: string;
}

export const INITIAL_PHASES: IntakePhase[] = [
    { status: "INTAKE", label: "Your Family", description: "Tell us about your household." },
    { status: "PENDING_EXTERNAL_ACTION", label: "Contract & Consent", description: "Sign the membership contract and consent to a background check." },
    { status: "PENDING_BG_REVIEW", label: "Background Review", description: "Our team confirms the background check." },
    { status: "PENDING_PAYMENT", label: "Payment", description: "Pay your annual membership dues." },
    { status: "ACTIVE", label: "Member", description: "Welcome to the Treehouse!" },
];

/** Index of a status within the INITIAL flow, or -1 if it isn't a flow phase. */
export function phaseIndex(status: MembershipProcessStatus): number {
    return INITIAL_PHASES.findIndex((p) => p.status === status);
}

/**
 * Statuses where an application is still open (work remains). Excludes the
 * terminal ACTIVE and the off-track BLOCKED. Renewal-specific statuses are not
 * part of the INITIAL flow.
 */
export const IN_FLIGHT_INITIAL_STATUSES: MembershipProcessStatus[] = [
    "INTAKE",
    "PENDING_EXTERNAL_ACTION",
    "PENDING_BG_REVIEW",
    "PENDING_PAYMENT",
];
