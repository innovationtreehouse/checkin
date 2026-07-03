import type { PrismaClient } from "@/generated/prisma/client";

/**
 * One-time importer for the legacy Zoho membership export (3 JSON files).
 *
 * This is a DATA MIGRATION, not a re-onboarding: the people here already finished
 * intake in the old system, so we land them directly as Households + Participants
 * (+ an ACTIVE Membership where they actually paid and signed) WITHOUT walking the
 * interactive intake state machine in src/lib/membership/intake.ts — that path
 * fires Shopify draft orders, Zoho webhooks, and congratulations emails we must
 * not trigger for a bulk backfill.
 *
 * The pure transform (parse/build/resolve/flag) is separated from applyImport so it
 * can be unit-tested without a database. provenance + the prior-system background
 * check reference are written into AuditLog rows (there is no zohoId column).
 */

// ── Raw source row shapes ───────────────────────────────────────────────────

export interface RawPerson {
    Name: string;
    Email: string;
    Primary_Contact_E_mail: string;
    Date_Of_Birth: string;
    BG_Check_Status: string;
    Background_Check_Approval_Date: string;
    Background_Check_Approvals: string;
    ID: string;
}

export interface RawFamily {
    Primary_Contact_E_mail: string;
    Address: string;
    Primary_Contact_Name: string;
    Primary_Contact_DoB: string;
    ID: string;
}

export interface RawInput {
    Primary_Contact_E_mail: string;
    Payment_Status: string;
    Membership_Agreement_Status: string;
    Address: string;
    Primary_Contact_Name: string;
    Primary_Contact_DoB: string;
    ID: string;
    "Participant_Information.Name": string;
}

export interface ZohoFiles {
    people: RawPerson[];
    families: RawFamily[];
    inputs: RawInput[];
}

/**
 * Danae Kay is the one household whose join key disagrees between files: people
 * are keyed by danaekay@innovationtreehouse.org, families/inputs by
 * danaekay17@gmail.com. Alias the people key onto the family key so the household
 * merges into one. (Her own Participant email is preserved as-is.)
 */
export const PCE_ALIASES: Record<string, string> = {
    "danaekay@innovationtreehouse.org": "danaekay17@gmail.com",
};

// ── Built (cleaned) model ────────────────────────────────────────────────────

export interface BuiltMember {
    name: string;
    email: string | null; // null when blank, or stripped by collision resolution
    dob: Date | null;
    lastBackgroundCheck: Date | null;
    isPrimary: boolean;
    /** No DoB in Zoho but treated as an adult — only the household primary contact
     *  is inferred (they signed the Zoho membership as the responsible adult). Maps
     *  to Participant.isDeclaredAdult so they show as "Adult", not "Age Unavailable",
     *  under the new age model (#606). Members WITH a DoB derive age from it. */
    isDeclaredAdult: boolean;
    /** Provenance / prior-system reference, surfaced into the AuditLog row. */
    source: {
        zohoId: string;
        rawEmail: string;
        bgStatus: string;
        bgApprovalDate: string;
        bgApprovers: string;
    };
}

/** Legacy Zoho stores address as one string; the modern Household has separate columns. */
export interface ParsedAddress {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
}

export interface BuiltHousehold {
    groupKey: string; // canonical (aliased) primary-contact email
    name: string;
    address: ParsedAddress;
    members: BuiltMember[];
    membershipActive: boolean;
    source: { familyZohoId: string | null; inputZohoId: string | null; rawPrimaryEmail: string; rawAddress: string | null };
}

export interface ImportReport {
    households: number;
    participants: number;
    activeMemberships: number;
    blankNamesSkipped: {
        zohoId: string;
        householdKey: string;
        householdPrimaryName: string;
        rowEmail: string;
        rowDob: string;
    }[];
    emailCollisions: { email: string; keptFor: string; nulledFor: string[] }[];
    youthAsPrimary: { name: string; dob: string; householdKey: string }[];
    secondaryAdultsNotPromoted: number;
    flags: string[];
}

export interface BuiltImport {
    households: BuiltHousehold[];
    report: ImportReport;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ZIP_RE = /^\d{5}(-\d{4})?$/;
/** "Texas"/"tx" → "TX"; any 2-letter → upper; else leave as-is. */
const normState = (s: string) => (/^texas$/i.test(s) ? "TX" : s.length === 2 ? s.toUpperCase() : s);

/**
 * Split a legacy Zoho single-line address ("line1[, line2], city, state, zip")
 * into the modern Household columns. Parses right-to-left — zip, state, city are
 * the trailing fields — and never consumes the last remaining part, so partial or
 * malformed rows keep their street line instead of dropping it.
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress {
    const parts = (raw || "").split(",").map((p) => p.trim()).filter(Boolean);
    const out: ParsedAddress = { line1: null, line2: null, city: null, state: null, postalCode: null };
    if (parts.length === 0) return out;
    if (parts.length > 1 && ZIP_RE.test(parts[parts.length - 1])) out.postalCode = parts.pop()!;
    if (parts.length > 1) out.state = normState(parts.pop()!);
    if (parts.length > 1) out.city = parts.pop()!;
    out.line1 = parts.shift() ?? null;
    out.line2 = parts.length ? parts.join(", ") : null;
    return out;
}

const norm = (e: string) => (e || "").trim().toLowerCase();
const canonKey = (e: string) => PCE_ALIASES[norm(e)] ?? norm(e);
const lastName = (full: string) => (full || "").trim().split(/\s+/).filter(Boolean).pop() || "";
/** Trim + collapse internal whitespace, lowercased — for name equality (Zoho has stray spaces). */
const normName = (n: string) => (n || "").trim().replace(/\s+/g, " ").toLowerCase();

/** Parse Zoho's MM/DD/YYYY into a Date at UTC noon (TZ-safe). Blank/invalid → null. */
export function parseUSDate(s: string): Date | null {
    const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const [, mm, dd, yyyy] = m;
    const month = Number(mm), day = Number(dd), year = Number(yyyy);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    // Reject overflow (e.g. 02/31 rolling into March).
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return d;
}

function ageYears(dob: Date | null, now: Date): number | null {
    if (!dob) return null;
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const before =
        now.getUTCMonth() < dob.getUTCMonth() ||
        (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
    if (before) age--;
    return age;
}

export function parseZoho(raw: {
    list: { Full_Member_List: RawPerson[] };
    families: { All_Member_Families: RawFamily[] };
    inputs: { All_Member_Inputs: RawInput[] };
}): ZohoFiles {
    return {
        people: raw.list.Full_Member_List ?? [],
        families: raw.families.All_Member_Families ?? [],
        inputs: raw.inputs.All_Member_Inputs ?? [],
    };
}

// ── Build ──────────────────────────────────────────────────────────────────

/**
 * Group people into households by (aliased) Primary_Contact_E_mail, join the
 * family + input rows, resolve the unique-email collisions, and collect a report.
 * `now` is injected so the transform stays pure/testable.
 */
export function buildImport(files: ZohoFiles, now: Date): BuiltImport {
    const report: ImportReport = {
        households: 0,
        participants: 0,
        activeMemberships: 0,
        blankNamesSkipped: [],
        emailCollisions: [],
        youthAsPrimary: [],
        secondaryAdultsNotPromoted: 0,
        flags: [],
    };

    const familyByKey = new Map(files.families.map((f) => [canonKey(f.Primary_Contact_E_mail), f]));
    const inputByKey = new Map(files.inputs.map((i) => [canonKey(i.Primary_Contact_E_mail), i]));

    // Group people by canonical household key.
    const groups = new Map<string, RawPerson[]>();
    for (const p of files.people) {
        const key = canonKey(p.Primary_Contact_E_mail);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
    }

    if (PCE_ALIASES["danaekay@innovationtreehouse.org"]) {
        report.flags.push(
            "Danae Kay: people keyed danaekay@innovationtreehouse.org merged onto family key danaekay17@gmail.com (join-key mismatch).",
        );
    }

    const households: BuiltHousehold[] = [];

    for (const [key, peopleRaw] of groups) {
        const family = familyByKey.get(key);
        const input = inputByKey.get(key);

        // Skip blank-name rows (cannot make a meaningful Participant).
        const people = peopleRaw.filter((p) => {
            if (!p.Name.trim()) {
                report.blankNamesSkipped.push({
                    zohoId: p.ID,
                    householdKey: key,
                    householdPrimaryName: (family?.Primary_Contact_Name || "").trim(),
                    rowEmail: p.Email.trim(),
                    rowDob: p.Date_Of_Birth.trim(),
                });
                return false;
            }
            return true;
        });
        if (people.length === 0) continue;

        const primaryName = (family?.Primary_Contact_Name || "").trim();
        // Primary contact detection. The family's Primary_Contact_Name is the most
        // reliable signal and MUST come first: when a whole family shares the
        // parent's email, matching on email alone picks whichever row is listed
        // first (often a child). Fall back to email-owner, then the oldest member.
        let primaryIdx = primaryName ? people.findIndex((p) => normName(p.Name) === normName(primaryName)) : -1;
        if (primaryIdx < 0) primaryIdx = people.findIndex((p) => norm(p.Email) === key && norm(p.Email) !== "");
        if (primaryIdx < 0) {
            // Oldest member with a known DOB (the likely adult), else the first row.
            let oldest = -1;
            let oldestTime = Infinity;
            people.forEach((p, i) => {
                const d = parseUSDate(p.Date_Of_Birth);
                if (d && d.getTime() < oldestTime) {
                    oldestTime = d.getTime();
                    oldest = i;
                }
            });
            primaryIdx = oldest >= 0 ? oldest : 0;
        }

        const members: BuiltMember[] = people.map((p, idx) => {
            const dob = parseUSDate(p.Date_Of_Birth);
            const approved = p.BG_Check_Status.trim() === "Approved";
            const bgDate = approved ? parseUSDate(p.Background_Check_Approval_Date) : null;
            return {
                name: p.Name.trim(),
                email: norm(p.Email) || null,
                dob,
                lastBackgroundCheck: bgDate,
                isPrimary: idx === primaryIdx,
                // Only the primary contact is inferred adult, and only when Zoho has
                // no DoB for them (with a DoB, age is derived). Other no-DoB members
                // stay unknown for board review.
                isDeclaredAdult: idx === primaryIdx && !dob,
                source: {
                    zohoId: p.ID,
                    rawEmail: p.Email.trim(),
                    bgStatus: p.BG_Check_Status.trim(),
                    bgApprovalDate: p.Background_Check_Approval_Date.trim(),
                    bgApprovers: p.Background_Check_Approvals.trim(),
                },
            };
        });

        const primary = members[primaryIdx];
        const nameSource = primaryName || primary.name;
        const ln = lastName(nameSource);

        const membershipActive =
            (input?.Payment_Status || "").trim() === "Completed" &&
            (input?.Membership_Agreement_Status || "").trim() === "Completed";

        // Flag youth listed as the household's primary contact.
        const primaryAge = ageYears(primary.dob, now);
        if (primaryAge !== null && primaryAge < 18) {
            report.youthAsPrimary.push({
                name: primary.name,
                dob: primary.dob?.toISOString().slice(0, 10) ?? "?",
                householdKey: key,
            });
        }
        // Non-primary members are NOT auto-promoted to lead (Zoho doesn't mark
        // adult vs child); count adults so the board knows to review.
        report.secondaryAdultsNotPromoted += members.filter(
            (m) => !m.isPrimary && (ageYears(m.dob, now) ?? 0) >= 18,
        ).length;

        const rawAddress = (family?.Address || "").trim() || null;
        households.push({
            groupKey: key,
            name: ln ? `${ln} Household` : "Household",
            address: parseAddress(rawAddress),
            members,
            membershipActive,
            source: {
                familyZohoId: family?.ID ?? null,
                inputZohoId: input?.ID ?? null,
                rawPrimaryEmail: key,
                rawAddress,
            },
        });
    }

    resolveEmailCollisions(households, report);

    report.households = households.length;
    report.participants = households.reduce((n, h) => n + h.members.length, 0);
    report.activeMemberships = households.filter((h) => h.membershipActive).length;
    report.flags.push(
        "All households imported without an emergency contact (not present in Zoho) — members/board must fill this in.",
    );

    const declaredAdults = households.reduce((n, h) => n + h.members.filter((m) => m.isDeclaredAdult).length, 0);
    if (declaredAdults > 0) {
        report.flags.push(
            `${declaredAdults} household primary contact(s) had no date of birth in Zoho and were marked as declared adults (shown as "Adult") — board should confirm.`,
        );
    }

    return { households, report };
}

/**
 * Participant.email is @unique, but Zoho reuses one address across a household
 * (and, for jms367@cornell.edu, across two households). Keep the email on the
 * household primary contact; null it on everyone else who shares it. Mutates
 * members in place and records each collision in the report.
 */
export function resolveEmailCollisions(households: BuiltHousehold[], report: ImportReport): void {
    type Ref = { member: BuiltMember; household: BuiltHousehold };
    const byEmail = new Map<string, Ref[]>();
    for (const h of households) {
        for (const member of h.members) {
            if (!member.email) continue;
            if (!byEmail.has(member.email)) byEmail.set(member.email, []);
            byEmail.get(member.email)!.push({ member, household: h });
        }
    }

    for (const [email, refs] of byEmail) {
        if (refs.length < 2) continue;
        // Winner: a primary contact; prefer the one whose household key IS this email.
        const keeper =
            refs.find((r) => r.member.isPrimary && r.household.groupKey === email) ??
            refs.find((r) => r.member.isPrimary) ??
            refs[0];
        const nulled: string[] = [];
        for (const r of refs) {
            if (r === keeper) continue;
            r.member.email = null;
            nulled.push(`${r.member.name} (${r.household.groupKey})`);
        }
        report.emailCollisions.push({
            email,
            keptFor: `${keeper.member.name} (${keeper.household.groupKey})`,
            nulledFor: nulled,
        });
        // Cross-household reuse very likely means the same human entered twice.
        const households_ = new Set(refs.map((r) => r.household.groupKey));
        if (households_.size > 1) {
            report.flags.push(
                `Email ${email} reused across ${households_.size} households (${[...households_].join(", ")}) — possible duplicate person, board review.`,
            );
        }
    }
}

// ── Apply ────────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export interface ApplyResult {
    householdsCreated: number;
    householdsUpdated: number;
    participantsCreated: number;
    participantsUpdated: number;
    membershipsActivated: number;
}

const BG_NOTE = "Background check approved/audited in prior system (Zoho) before migration.";

async function audit(
    tx: Tx,
    actorId: number,
    action: "CREATE" | "EDIT",
    tableName: string,
    affectedEntityId: number,
    newData: object,
) {
    await tx.auditLog.create({
        data: { actorId, action, tableName, affectedEntityId, newData },
    });
}

/**
 * Persist a built import. Run inside a single transaction by the caller. Matches
 * existing rows by email (else householdId+name) so a re-run is non-duplicating
 * (renames are not detected — there is no stable import key).
 */
export async function applyImport(
    tx: Tx,
    built: BuiltImport,
    actorId: number,
): Promise<ApplyResult> {
    const res: ApplyResult = {
        householdsCreated: 0,
        householdsUpdated: 0,
        participantsCreated: 0,
        participantsUpdated: 0,
        membershipsActivated: 0,
    };

    for (const h of built.households) {
        // Locate an existing household via any member email already in the DB.
        let householdId: number | null = null;
        for (const m of h.members) {
            if (!m.email) continue;
            const existing = await tx.person.findUnique({ where: { email: m.email } });
            if (existing) {
                householdId = existing.householdId;
                break;
            }
        }

        const addr = h.address;
        if (householdId === null) {
            const created = await tx.household.create({
                data: { name: h.name, ...addr },
            });
            householdId = created.id;
            res.householdsCreated++;
            await audit(tx, actorId, "CREATE", "Household", householdId, {
                name: h.name,
                address: addr,
                source: { system: "Zoho", familyId: h.source.familyZohoId, primaryEmail: h.source.rawPrimaryEmail, rawAddress: h.source.rawAddress },
            });
        } else {
            await tx.household.update({ where: { id: householdId }, data: { name: h.name, ...addr } });
            res.householdsUpdated++;
            await audit(tx, actorId, "EDIT", "Household", householdId, {
                name: h.name,
                address: addr,
                source: { system: "Zoho", familyId: h.source.familyZohoId, rawAddress: h.source.rawAddress },
            });
        }

        let primaryParticipantId: number | null = null;

        for (const m of h.members) {
            const data = {
                name: m.name,
                ...(m.email ? { email: m.email } : {}),
                dateOfBirth: m.dob,
                lastBackgroundCheck: m.lastBackgroundCheck,
                isDeclaredAdult: m.isDeclaredAdult,
                householdId,
            };

            let participant = m.email ? await tx.person.findUnique({ where: { email: m.email } }) : null;
            if (!participant) {
                participant = await tx.person.findFirst({ where: { householdId, name: m.name } });
            }

            const bg = m.lastBackgroundCheck
                ? {
                      backgroundCheck: {
                          status: m.source.bgStatus,
                          approvalDate: m.source.bgApprovalDate,
                          approvers: m.source.bgApprovers,
                          note: BG_NOTE,
                      },
                  }
                : {};

            if (participant) {
                participant = await tx.person.update({ where: { id: participant.id }, data });
                res.participantsUpdated++;
                await audit(tx, actorId, "EDIT", "Participant", participant.id, {
                    name: m.name,
                    email: m.email,
                    source: { system: "Zoho", personId: m.source.zohoId },
                    ...bg,
                });
            } else {
                participant = await tx.person.create({ data });
                res.participantsCreated++;
                await audit(tx, actorId, "CREATE", "Participant", participant.id, {
                    name: m.name,
                    email: m.email,
                    source: { system: "Zoho", personId: m.source.zohoId },
                    ...bg,
                });
            }

            if (m.isPrimary) primaryParticipantId = participant.id;
        }

        // The primary contact is the household lead.
        if (primaryParticipantId !== null) {
            await tx.householdLead.upsert({
                where: { householdId_personId: { householdId, personId: primaryParticipantId } },
                create: { householdId, personId: primaryParticipantId },
                update: {},
            });
        }

        // ACTIVE membership only where they paid AND signed in Zoho.
        if (h.membershipActive) {
            const before = await tx.orgMembership.findUnique({ where: { householdId } });
            const membership = await tx.orgMembership.upsert({
                where: { householdId },
                create: { householdId, status: "ACTIVE" },
                update: { status: "ACTIVE" },
            });
            if (!before || before.status !== "ACTIVE") {
                res.membershipsActivated++;
                await audit(tx, actorId, before ? "EDIT" : "CREATE", "OrgMembership", membership.id, {
                    status: "ACTIVE",
                    source: { system: "Zoho import" },
                });
            }
        }
    }

    return res;
}

// ── Report rendering ──────────────────────────────────────────────────────────

export function renderReport(report: ImportReport): string {
    const lines: string[] = [];
    lines.push("── Zoho import report ──────────────────────────────────");
    lines.push(`Households:          ${report.households}`);
    lines.push(`Participants:        ${report.participants}`);
    lines.push(`Active memberships:  ${report.activeMemberships}`);
    lines.push(`Blank-name skipped:  ${report.blankNamesSkipped.length}  (empty member rows — fix or delete in Zoho)`);
    for (const b of report.blankNamesSkipped) {
        const primary = b.householdPrimaryName ? `primary: ${b.householdPrimaryName}` : "no family primary on file";
        const extra = [b.rowEmail && `email ${b.rowEmail}`, b.rowDob && `dob ${b.rowDob}`].filter(Boolean).join(", ") || "no name/email/dob on the row";
        lines.push(`    - person ID ${b.zohoId} in household "${b.householdKey}" (${primary}) — ${extra}`);
    }
    lines.push(`Email collisions:    ${report.emailCollisions.length}`);
    for (const c of report.emailCollisions) {
        lines.push(`    - ${c.email}: kept for ${c.keptFor}; nulled for ${c.nulledFor.join(", ")}`);
    }
    lines.push(`Youth as primary:   ${report.youthAsPrimary.length}`);
    for (const m of report.youthAsPrimary) lines.push(`    - ${m.name} (DOB ${m.dob}, household ${m.householdKey})`);
    lines.push(`Secondary adults not promoted to lead: ${report.secondaryAdultsNotPromoted}`);
    lines.push("Flags:");
    for (const f of report.flags) lines.push(`    ! ${f}`);
    lines.push("────────────────────────────────────────────────────────");
    return lines.join("\n");
}
