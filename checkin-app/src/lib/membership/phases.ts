import type { MembershipProcess, MembershipProcessStatus } from "@/generated/prisma/client";

/**
 * Applicant-facing phases of an INITIAL membership application, in order.
 * Drives the left-rail flow diagram (MembershipFlowStepper) and lets the API
 * report "where am I?" without leaking internal mechanics.
 *
 * The background check is NOT a sequential phase here — it runs as a parallel
 * track (consent in the Contract & Background Check step, then review in the
 * background) and only gates the final ACTIVE transition. PENDING_BG_CLEARANCE
 * (paid, awaiting the check) and BLOCKED are off-track states handled separately
 * (never shown as their own step).
 */
export interface IntakePhase {
    status: MembershipProcessStatus;
    label: string;
    description: string;
}

export const INITIAL_PHASES: IntakePhase[] = [
    { status: "INTAKE", label: "Your Family", description: "Tell us about your household." },
    { status: "PENDING_EXTERNAL_ACTION", label: "Contract & Background Check", description: "Sign the contract and start your background check." },
    { status: "PENDING_PAYMENT", label: "Payment", description: "Pay your annual membership dues." },
    { status: "ACTIVE", label: "Member", description: "Welcome to the Treehouse!" },
];

/**
 * Stepper position for a status: how many INITIAL_PHASES steps are complete.
 * PENDING_BG_CLEARANCE (paid, awaiting the check) sits between Payment and
 * Member — payment shows complete, Member is the pending current step. BLOCKED
 * and other off-track statuses return -1 (handled with an inline alert).
 */
export function stepperActiveIndex(status: MembershipProcessStatus | null): number {
    switch (status) {
        case "INTAKE": return 0;
        case "PENDING_EXTERNAL_ACTION": return 1;
        case "PENDING_PAYMENT": return 2;
        case "PENDING_BG_CLEARANCE": return 3;
        case "ACTIVE": return 4;
        default: return -1;
    }
}

/**
 * Statuses where an application is still open (work remains). Excludes the
 * terminal ACTIVE and the off-track BLOCKED. Renewal-specific statuses are not
 * part of the INITIAL flow. PENDING_BG_REVIEW is retained for any legacy rows;
 * the live flow uses PENDING_BG_CLEARANCE for the paid-awaiting-check state.
 */
export const IN_FLIGHT_INITIAL_STATUSES: MembershipProcessStatus[] = [
    "INTAKE",
    "PENDING_EXTERNAL_ACTION",
    "PENDING_BG_REVIEW",
    "PENDING_PAYMENT",
    "PENDING_BG_CLEARANCE",
];

/**
 * The latest process awaiting applicant external action (contract signing).
 * Kind-agnostic by design — INITIAL applications AND renewals both re-sign here,
 * and gating on status alone keeps the sign button (getOrCreateContractSigningUrl)
 * in step with the status sync (syncContractStatus); a kind filter would render
 * the button then 409. Highest id == most recent (autoincrement). Returns
 * undefined when nothing is awaiting action — callers guard for that.
 */
export function latestPendingExternal<T extends Pick<MembershipProcess, "id" | "status">>(
    processes: T[] | null | undefined,
): T | undefined {
    return [...(processes ?? [])]
        .filter((p) => p.status === "PENDING_EXTERNAL_ACTION")
        .sort((a, b) => b.id - a.id)[0];
}
