/**
 * Dirty signal for the public registration form. Creation-only, so any data the
 * user has typed beyond the empty default counts as dirty — no snapshot needed,
 * just "is any field non-empty". Pure + standalone so the guard logic is
 * testable without importing the client page.
 */
type Parent = { name: string; email: string; phone: string };
type EmergencyContact = { name: string; phone: string };
type Person = { name: string; dob: string };

export function isRegistrationDirty(
  parents: Parent[],
  emergencyContact: EmergencyContact,
  participants: Person[],
): boolean {
  const filled = (v: string) => v.trim() !== '';
  return (
    parents.some((p) => filled(p.name) || filled(p.email) || filled(p.phone)) ||
    filled(emergencyContact.name) ||
    filled(emergencyContact.phone) ||
    participants.some((p) => filled(p.name) || filled(p.dob))
  );
}
