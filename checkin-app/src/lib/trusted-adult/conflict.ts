/**
 * Conflict-of-interest rule for trusted-adult reviews. A board member may not decide
 * (or appear able to decide) a review tied to their own household, nor one where they
 * are the counterparty (the trusted adult themselves). Another board member must.
 *
 * Pure + dependency-free on purpose: the server (decideReview) enforces it and the
 * client (the board review page) gates the buttons off the SAME rule, so the two can't
 * drift. Callers pass scalars they already have; ids are participant ids.
 */
export function isTrustedAdultConflict(args: {
    actorParticipantId: number | null | undefined;
    actorHouseholdId: number | null | undefined;
    taHouseholdId: number | null | undefined;
    taCounterpartyParticipantId: number | null | undefined;
}): boolean {
    const { actorParticipantId, actorHouseholdId, taHouseholdId, taCounterpartyParticipantId } = args;
    return (
        (actorHouseholdId != null && actorHouseholdId === taHouseholdId) ||
        (actorParticipantId != null && actorParticipantId === taCounterpartyParticipantId)
    );
}
