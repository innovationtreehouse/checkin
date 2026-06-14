import { countHouseholdsMissingValidContact } from "./service";

export interface EmergencyContactNotifications {
    /**
     * Member / in-intake households with no valid emergency contact — the
     * "a member was added over the contact and nobody added a replacement" alarm.
     */
    householdsMissingValidContact: number;
}

/**
 * One domain's contribution to GET /api/notifications. Visible to the same roles
 * that can read the emergency-contacts directory (sysadmin / board / keyholder).
 */
export async function getEmergencyContactNotifications(user: {
    sysadmin?: boolean;
    boardMember?: boolean;
    keyholder?: boolean;
}): Promise<EmergencyContactNotifications> {
    const canSee = !!(user.sysadmin || user.boardMember || user.keyholder);
    return { householdsMissingValidContact: canSee ? await countHouseholdsMissingValidContact() : 0 };
}
