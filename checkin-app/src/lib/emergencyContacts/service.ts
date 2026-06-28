import prisma from "@/lib/prisma";
import type { Prisma, EmergencyContact } from "@/generated/prisma/client";
import { identityKeys, sameIdentity, normalizeEmail, normalizePhone } from "./identity";

/**
 * Emergency-contact write/read model. Enforces the not-a-household-member rule
 * in two directions:
 *
 *  - Direction A (hard): when a lead actively creates/edits a contact, reject a
 *    candidate that matches a current household member. See {@link assertExternal}.
 *  - Direction B (soft): when a member is added/changed under an existing valid
 *    contact, the collision can't be prevented retroactively, so we flag the
 *    contact invalid (conflictParticipantId set), keep the row for audit, and
 *    return a warning that drives the lead to add a replacement. See
 *    {@link reconcileHouseholdConflicts}.
 *
 * A contact is VALID when conflictParticipantId is null and it has both a name
 * and a phone. Households are required to keep >= 1 valid contact.
 */

export class EmergencyContactError extends Error {
    constructor(public readonly code: "is_member" | "incomplete" | "not_found", message: string) {
        super(message);
        this.name = "EmergencyContactError";
    }
}

/** Accepts either the base client or a transaction client. */
type Db = Prisma.TransactionClient | typeof prisma;

export interface ContactInput {
    name: string;
    phone: string;
    email?: string | null;
    relationship?: string | null;
    priority?: number;
}

export interface EmergencyContactWarning {
    code: "EMERGENCY_CONTACT_CONFLICT";
    householdId: number;
    /** Contacts newly flagged invalid by the change that just happened. */
    conflictedContactIds: number[];
    /** Whether the household still has at least one valid contact. */
    hasValidContact: boolean;
    message: string;
}

type MemberLike = { id: number; name: string | null; email: string | null; phone: string | null };

function loadMembers(db: Db, householdId: number): Promise<MemberLike[]> {
    return db.participant.findMany({
        where: { householdId },
        select: { id: true, name: true, email: true, phone: true },
    });
}

/** The member a candidate collides with, or null. */
function matchingMember(candidate: { name?: string | null; phone?: string | null; email?: string | null }, members: MemberLike[]): MemberLike | null {
    const ck = identityKeys(candidate);
    for (const m of members) {
        if (sameIdentity(ck, identityKeys(m))) return m;
    }
    return null;
}

function cleaned(input: ContactInput) {
    return {
        name: input.name.trim(),
        phone: input.phone.trim(),
        email: input.email?.trim() ? input.email.trim() : null,
        relationship: input.relationship?.trim() ? input.relationship.trim() : null,
        phoneDigits: normalizePhone(input.phone),
        emailNorm: normalizeEmail(input.email),
    };
}

function requireComplete(input: ContactInput) {
    if (!input.name?.trim() || !input.phone?.trim()) {
        throw new EmergencyContactError("incomplete", "An emergency contact needs both a name and a phone number.");
    }
}

/**
 * Direction A: throw if the candidate is a member of this household. Use before
 * any lead-initiated create/edit of a contact.
 */
export async function assertExternal(db: Db, householdId: number, input: ContactInput): Promise<void> {
    const members = await loadMembers(db, householdId);
    const match = matchingMember(input, members);
    if (match) {
        throw new EmergencyContactError(
            "is_member",
            `${input.name?.trim() || "That person"} is part of this household and can't be its emergency contact. Choose someone outside the household.`,
        );
    }
}

export async function createContact(db: Db, householdId: number, input: ContactInput): Promise<EmergencyContact> {
    requireComplete(input);
    await assertExternal(db, householdId, input);
    const c = cleaned(input);
    return db.emergencyContact.create({
        data: {
            householdId,
            name: c.name,
            phone: c.phone,
            email: c.email,
            relationship: c.relationship,
            priority: input.priority ?? 0,
            phoneDigits: c.phoneDigits,
            emailNorm: c.emailNorm,
        },
    });
}

export async function updateContact(db: Db, householdId: number, contactId: number, input: ContactInput): Promise<EmergencyContact> {
    requireComplete(input);
    const existing = await db.emergencyContact.findFirst({ where: { id: contactId, householdId } });
    if (!existing) throw new EmergencyContactError("not_found", "Emergency contact not found.");
    await assertExternal(db, householdId, input);
    const c = cleaned(input);
    // Editing re-confirms the contact: clear any stale conflict flag.
    return db.emergencyContact.update({
        where: { id: contactId },
        data: {
            name: c.name,
            phone: c.phone,
            email: c.email,
            relationship: c.relationship,
            ...(input.priority !== undefined && { priority: input.priority }),
            phoneDigits: c.phoneDigits,
            emailNorm: c.emailNorm,
            conflictParticipantId: null,
            conflictedAt: null,
        },
    });
}

export async function deleteContact(db: Db, householdId: number, contactId: number): Promise<void> {
    const existing = await db.emergencyContact.findFirst({ where: { id: contactId, householdId } });
    if (!existing) throw new EmergencyContactError("not_found", "Emergency contact not found.");
    await db.emergencyContact.delete({ where: { id: contactId } });
}

/**
 * Compatibility helper for the single-field legacy surfaces (onboarding,
 * household settings, membership intake). Upserts the primary (lowest-priority)
 * contact.
 *
 * Tolerant of partial input so resumable forms can save a half-filled contact:
 * blank name+phone is a no-op; a partial contact is persisted as-is without the
 * member check. Direction A is enforced only once BOTH name and phone are
 * present (a "real" contact), at which point a successful check also clears any
 * stale conflict flag. The submit-time floor ({@link householdHasValidContact})
 * is what guarantees a complete, valid contact before a household advances.
 */
export async function upsertPrimaryContact(
    db: Db,
    householdId: number,
    fields: { name?: string | null; phone?: string | null },
): Promise<EmergencyContact | null> {
    const name = (fields.name ?? "").trim();
    const phone = (fields.phone ?? "").trim();
    if (!name && !phone) return null;

    const complete = !!name && !!phone;
    if (complete) await assertExternal(db, householdId, { name, phone });

    const data = {
        name,
        phone,
        phoneDigits: normalizePhone(phone),
        ...(complete && { conflictParticipantId: null, conflictedAt: null }),
    };

    const primary = await db.emergencyContact.findFirst({
        where: { householdId },
        orderBy: [{ priority: "asc" }, { id: "asc" }],
    });
    if (primary) return db.emergencyContact.update({ where: { id: primary.id }, data });
    return db.emergencyContact.create({ data: { householdId, priority: 0, ...data } });
}

export function listContacts(db: Db, householdId: number): Promise<EmergencyContact[]> {
    return db.emergencyContact.findMany({ where: { householdId }, orderBy: [{ priority: "asc" }, { id: "asc" }] });
}

export function listValidContacts(db: Db, householdId: number): Promise<EmergencyContact[]> {
    return db.emergencyContact.findMany({
        where: { householdId, conflictParticipantId: null, name: { not: "" }, phone: { not: "" } },
        orderBy: [{ priority: "asc" }, { id: "asc" }],
    });
}

export async function getPrimaryValidContact(db: Db, householdId: number): Promise<EmergencyContact | null> {
    return (await listValidContacts(db, householdId))[0] ?? null;
}

export async function householdHasValidContact(db: Db, householdId: number): Promise<boolean> {
    const count = await db.emergencyContact.count({
        where: { householdId, conflictParticipantId: null, name: { not: "" }, phone: { not: "" } },
    });
    return count > 0;
}

/**
 * Direction B: after a member is added/changed, re-evaluate every contact in the
 * household. Newly-colliding contacts are flagged invalid; contacts whose
 * collision has cleared (member left/changed) are un-flagged. Returns the
 * contacts that were freshly flagged by this pass.
 */
export async function reconcileHouseholdConflicts(db: Db, householdId: number): Promise<EmergencyContact[]> {
    const [members, contacts] = await Promise.all([loadMembers(db, householdId), listContacts(db, householdId)]);
    const memberById = new Map(members.map((m) => [m.id, m]));
    const freshlyFlagged: EmergencyContact[] = [];

    for (const ec of contacts) {
        const match = matchingMember({ name: ec.name, phone: ec.phone, email: ec.email }, members);
        const isFlagged = ec.conflictParticipantId !== null;

        if (match && !isFlagged) {
            await db.emergencyContact.update({
                where: { id: ec.id },
                data: { conflictParticipantId: match.id, conflictedAt: new Date() },
            });
            freshlyFlagged.push(ec);
        } else if (!match && isFlagged) {
            // Stale flag: the colliding member is gone or no longer matches.
            await db.emergencyContact.update({ where: { id: ec.id }, data: { conflictParticipantId: null, conflictedAt: null } });
        } else if (match && isFlagged && ec.conflictParticipantId !== match.id && !memberById.has(ec.conflictParticipantId!)) {
            // Re-point a flag whose original member is gone but a new one collides.
            await db.emergencyContact.update({ where: { id: ec.id }, data: { conflictParticipantId: match.id, conflictedAt: new Date() } });
        }
    }
    return freshlyFlagged;
}

/**
 * Run reconciliation and produce a UI warning when a contact was just
 * invalidated and/or the household has dropped below one valid contact. Returns
 * null when nothing needs the lead's attention.
 */
export async function reconcileAndWarn(db: Db, householdId: number): Promise<EmergencyContactWarning | null> {
    const flagged = await reconcileHouseholdConflicts(db, householdId);
    if (flagged.length === 0) return null;
    const hasValidContact = await householdHasValidContact(db, householdId);
    return {
        code: "EMERGENCY_CONTACT_CONFLICT",
        householdId,
        conflictedContactIds: flagged.map((c) => c.id),
        hasValidContact,
        message: hasValidContact
            ? "An emergency contact is now also a household member and was marked invalid. Please review your emergency contacts."
            : "Your emergency contact is now a household member, so your household has no valid emergency contact. Please add one.",
    };
}

/**
 * The predicate behind both the notification count and the Membership Audit list
 * view: member/in-intake households with zero valid emergency contacts (the
 * "lead didn't remediate" alarm). A household is in scope when it has an ACTIVE
 * membership or an in-flight membership process. Returns the household ids so
 * callers can either count them or hydrate them.
 */
export async function findHouseholdsMissingValidContact(db: Db = prisma): Promise<number[]> {
    const scoped = await db.household.findMany({
        where: {
            membership: { is: { OR: [{ status: "ACTIVE" }, { processes: { some: { status: { not: "ACTIVE" } } } }] } },
        },
        select: { id: true },
    });
    if (scoped.length === 0) return [];
    const withValid = await db.emergencyContact.findMany({
        where: {
            householdId: { in: scoped.map((h) => h.id) },
            conflictParticipantId: null,
            name: { not: "" },
            phone: { not: "" },
        },
        select: { householdId: true },
        distinct: ["householdId"],
    });
    const validSet = new Set(withValid.map((c) => c.householdId));
    return scoped.filter((h) => !validSet.has(h.id)).map((h) => h.id);
}

export async function countHouseholdsMissingValidContact(db: Db = prisma): Promise<number> {
    return (await findHouseholdsMissingValidContact(db)).length;
}
