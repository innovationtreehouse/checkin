import { sharesHousehold } from "@/lib/conflictOfInterest";

/**
 * Conflict-of-interest rule for trusted-adult reviews. A board member may not decide
 * (or appear able to decide) a review tied to their own household, nor one where they
 * are the counterparty (the trusted adult themselves). Another board member must.
 *
 * The same-household leg is the shared {@link sharesHousehold} rule; the counterparty
 * leg (actor IS the trusted adult) is trusted-adult-specific and stays here. Pure +
 * dependency-free on purpose: the server (decideReview) enforces it and the client (the
 * board review page) gates the buttons off the SAME rule, so the two can't drift.
 * Callers pass scalars they already have; ids are participant ids.
 */
export function isTrustedAdultConflict(args: {
    actorParticipantId: number | null | undefined;
    actorHouseholdId: number | null | undefined;
    taHouseholdId: number | null | undefined;
    taTrustedAdultPersonId: number | null | undefined;
}): boolean {
    const { actorParticipantId, actorHouseholdId, taHouseholdId, taTrustedAdultPersonId } = args;
    return (
        sharesHousehold(actorHouseholdId, taHouseholdId) ||
        (actorParticipantId != null && actorParticipantId === taTrustedAdultPersonId)
    );
}
