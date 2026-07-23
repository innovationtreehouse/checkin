import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { personRecordIsActiveOrgMember } from "@/lib/orgMembership";
import { apiError } from "@/lib/api-response";
import { rolesToFlags } from "@/lib/roles";
import { LIVE_PERSON } from "@/lib/person/filters";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember', 'isOperations'] },
    async (req, auth) => {
        try {
            const url = new URL(req.url);
            const q = url.searchParams.get('q') || '';
            // Only `adults` is recognized; any other value (or none) filters by age not at all.
            const adultsOnly = url.searchParams.get('filter') === 'adults';

            const eighteenYearsAgo = new Date();
            eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

            const people = await prisma.person.findMany({
                // Both clauses below are ORs, so they go in an AND array rather than as
                // two `OR:` keys — a second top-level OR would silently overwrite the
                // first, and Prisma's recursive WhereInput accepts that without a type
                // error. `?q=x&filter=adults` must apply both.
                where: {
                    ...LIVE_PERSON,
                    AND: [
                        ...(q ? [{
                            OR: [
                                { name: { contains: q, mode: 'insensitive' as const } },
                                { email: { contains: q, mode: 'insensitive' as const } },
                            ]
                        }] : []),
                        // Adult = 18+. The isDeclaredAdult leg keeps members a lead marked
                        // 25+ without a DoB (schema.prisma) in the picker; a null-DoB person
                        // who was never declared adult is excluded, which is what a strict
                        // 18+ rule means — the "mark 25+" control in the Details modal is
                        // the affordance to fix that.
                        ...(adultsOnly ? [{
                            OR: [
                                { dateOfBirth: { lte: eighteenYearsAgo } },
                                { isDeclaredAdult: true },
                            ]
                        }] : []),
                    ],
                },
                take: 200,
                orderBy: { id: 'desc' },
                include: {
                    household: {
                        include: {
                            // Explicit select, not `true` — a plain include returns full
                            // Person rows one level down (lastBackgroundCheck, googleId,
                            // emailVerified, emailUndeliverableAt, ...), leaking every
                            // household member's sensitive fields regardless of the
                            // opsOnly strip below, which only touches the top-level person.
                            // id/name/email/isHouseholdLead is exactly what every consumer of
                            // this endpoint's household.householdMembers reads: the
                            // Assign-household picker and its household-member list, and the
                            // participant-merge page (isLeadWithOthers guard + [Lead] marker).
                            // isHouseholdLead is @sensitivity:public, so ops sees it too.
                            householdMembers: { select: { id: true, name: true, email: true, isHouseholdLead: true } },
                            orgMembership: true,
                        }
                    },
                    // isOperations has no column — every flag derives through this one
                    // relation so there's a single code path (rolesToFlags), not four
                    // mirror reads plus one table read.
                    roles: { select: { role: true } },
                }
            });

            // Operations holds the Participants directory (contacts) view only:
            // names, contact info (email/phone), and role pills (isBoardMember etc.
            // are @sensitivity:public org structure, not PII — not stripped). It is
            // denied background-check compliance dates (lastBackgroundCheck),
            // date of birth, and every non-contact field on a household's OTHER
            // members (see the explicit householdMembers select above). Household
            // orgMembership (and isMember, derived from it) IS shown to ops: every
            // field on that row — memberSince/status/isVolunteer — is
            // @sensitivity:public, so it is standing, not finance detail. The
            // household itself is an explicit projection, not a row spread, so the
            // Household's own home address (line1/line2/city/state/postalCode) and
            // free-text intakeNotes (hardship/medical/family disclosures) reach
            // nobody through this route — no consumer reads them off it. Board/
            // sysadmin keep the full shape.
            // See membership-ops/layout.tsx's Participants-only nav gate for ops.
            const opsOnly = auth.type === 'session' && auth.user.isOperations
                && !auth.user.isSysadmin && !auth.user.isBoardMember;

            const formatted = people.map(p => ({
                id: p.id,
                name: p.name,
                email: p.email,
                phone: p.phone,
                // `undefined` drops the key on JSON serialization — a stripped
                // response, not a null/zeroed one.
                dateOfBirth: opsOnly ? undefined : p.dateOfBirth,
                isDeclaredAdult: opsOnly ? undefined : p.isDeclaredAdult,
                lastBackgroundCheck: opsOnly ? undefined : p.lastBackgroundCheck,
                isMember: personRecordIsActiveOrgMember(p),
                ...rolesToFlags(p.roles),
                emailSuppressed: p.emailSuppressed,
                household: p.household ? {
                    id: p.household.id,
                    name: p.household.name,
                    householdMembers: p.household.householdMembers,
                    // Every OrgMembership field is @sensitivity:public — ops sees it.
                    orgMembership: p.household.orgMembership,
                } : null,
            }));

            return NextResponse.json({ people: formatted });
        } catch (error) {
            logger.error("Failed to fetch people:", error);
            return apiError("Failed to fetch people", 500);
        }
    }
);
