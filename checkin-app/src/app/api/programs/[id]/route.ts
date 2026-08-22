import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth, authenticateRequest } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { handler, notFound, forbidden, badRequest } from "@/security/handler";
import { isActiveOrgMember, isDuesSettled, isDuesSettledThrough, programCoverageDate } from "@/lib/orgMembership";
import { maybeAnnounceOnOpen } from "@/lib/programAnnounce";
import { adjustProgramInventory } from "@/lib/shopify";
import { dollarsToCentsOrNull } from "@inventory/money";
import { apiError } from "@/lib/api-response";
import { LIVE_PERSON } from "@/lib/person/filters";
import { validateProgramAgeBounds } from "@/lib/programAge";
import { parseDateOnly } from "@/lib/time";
import { ProgramPhase, EnrollmentStatus } from "@/generated/prisma/client";

// ORDER MATTERS: this export sits ABOVE getProgram so the routeAuthDrift
// guard attributes getProgram's edge-model reads to the nearest preceding
// exported METHOD (this GET) — moving it below silently un-attributes them.
// The registry stripper (security/stripper.ts) is a strict allowlist over each
// model's CLASSIFIED schema fields (see security/generated/classifications.ts,
// generated from /// @sensitivity comments) — it has no channel for a
// viewer-computed scalar that isn't a real Program column, and adding one
// would mean a schema change this feature doesn't get. So viewerIsMember /
// viewerMemberPricingEligible are computed AFTER the registry response comes
// back and merged on top, session callers only — the registry envelope above
// (association gate, per-tier stripping) runs completely untouched first.
// startAt/endAt are 'public' tier, so they always ride in `body` regardless of
// caller privilege; re-authenticating here is the same cheap session read
// authenticateRequest always does, just called a second time.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const res = await getProgram(req, ctx);
    if (res.status !== 200) return res;

    const auth = await authenticateRequest(req);
    if (auth.type !== 'session') return res;

    const body = (await res.json()) as { startAt: string | null; endAt: string | null };
    const coverageDate = programCoverageDate({
        startAt: body.startAt ? new Date(body.startAt) : null,
        endAt: body.endAt ? new Date(body.endAt) : null,
    });
    // viewerIsMember answers "is this household a Treehouse Member" (ACTIVE only);
    // viewerMemberPricingEligible answers the pricing question, which also covers a
    // paid household still awaiting background clearance (#1397).
    const [viewerIsMember, viewerMemberPricingEligible] = await Promise.all([
        isActiveOrgMember(auth.user.id),
        isDuesSettledThrough(auth.user.id, coverageDate),
    ]);
    return NextResponse.json({ ...body, viewerIsMember, viewerMemberPricingEligible });
}

const getProgram = handler<{ id: string }>('GET /api/programs/[id]', async ({ auth, params }) => {
    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) throw badRequest('Invalid program ID');

    // Explicit select, not include: whole rows would ship every pii/personal
    // column a lead mentor's view happens to grant (googleId, dateOfBirth,
    // allergies, the payment-plan flags) plus any column added later. The id /
    // programId / personId / householdId keys below are ROW_SCOPE_KEYs — drop
    // one and scopesHeld() fails closed and strips the row for the very roles
    // this route serves (see the emergencyContacts note).
    const program = await prisma.program.findUnique({
        where: { id: programId },
        select: {
            id: true,
            name: true,
            leadMentorId: true,
            startAt: true,
            endAt: true,
            phase: true,
            enrollmentStatus: true,
            orgMemberOnly: true,
            announceOnOpen: true,
            minAge: true,
            maxAge: true,
            maxParticipants: true,
            orgMemberPriceCents: true,
            nonOrgMemberPriceCents: true,
            shopifyProductId: true,
            shopifyVariantId: true,
            volunteers: {
                where: { person: LIVE_PERSON },
                select: {
                    programId: true,
                    personId: true,
                    isCore: true,
                    person: { select: { id: true, name: true, email: true } },
                },
            },
            participants: {
                where: { person: LIVE_PERSON },
                select: {
                    programId: true,
                    personId: true,
                    status: true,
                    pendingSince: true,
                    person: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            householdId: true,
                            household: {
                                select: {
                                    id: true,
                                    // The family's parents, for the roster's "call someone" band.
                                    // householdId and isHouseholdLead are BOTH scope keys for the
                                    // Person their_program_households binding: drop either and a
                                    // lead resolves no scope, so name/email/phone strip away.
                                    householdMembers: {
                                        where: { isHouseholdLead: true, ...LIVE_PERSON },
                                        orderBy: { id: "asc" },
                                        select: { id: true, householdId: true, isHouseholdLead: true, name: true, email: true, phone: true },
                                    },
                                    emergencyContacts: {
                                        where: { conflictParticipantId: null, name: { not: "" }, phone: { not: "" } },
                                        orderBy: [{ priority: "asc" }, { id: "asc" }],
                                        // householdId is the EmergencyContact ROW_SCOPE_KEY: without it
                                        // scopesHeld() fails closed (empty scope set) and the stripper drops
                                        // name/phone/relationship for EVERY viewer, incl. admin/board.
                                        select: { id: true, householdId: true, name: true, phone: true, relationship: true },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            events: {
                orderBy: { startAt: 'asc' },
                select: {
                    id: true,
                    programId: true,
                    name: true,
                    startAt: true,
                    endAt: true,
                    attendanceConfirmedAt: true,
                },
            },
            leadMentor: { select: { id: true, name: true, email: true } },
            _count: { select: { participants: { where: { person: LIVE_PERSON } }, volunteers: { where: { person: LIVE_PERSON } } } },
        },
    });

    if (!program) throw notFound('Program not found');

    const isSessionUser = auth.type === 'session';
    const sessionUser = isSessionUser ? auth.user : undefined;
    const isSysAdminOrBoard = !!(sessionUser?.isSysadmin || sessionUser?.isBoardMember);
    const isLeadMentor = !!sessionUser && sessionUser.id === program.leadMentorId;
    const isCoreVolunteer = !!sessionUser && program.volunteers.some(v => v.personId === sessionUser.id && v.isCore);
    const isPrivileged = isSysAdminOrBoard || isLeadMentor || isCoreVolunteer;

    // Dues settled, not "is a member": a paid household awaiting background
    // clearance is admitted to members-only programs (#1397).
    if (program.orgMemberOnly && !isPrivileged) {
        if (!sessionUser) throw notFound('Program not found');
        const duesSettled = await isDuesSettled(sessionUser.id);
        if (!duesSettled) throw forbidden('Forbidden: Member-Only Program');
    }

    // ── Association gate (deliberate inline exception) ──────────────────────────
    // The participant/volunteer ROSTER reveals who is enrolled in this program.
    // Each ProgramParticipant/ProgramVolunteer row AND Participant.name are tier
    // 'public', so the handler's per-field stripper CANNOT hide the association:
    // the existence of the row + the public name = the enrollment fact (incl.
    // youth). Only admission can hide it. The registry `authorize` grammar can't
    // express "enrolled in THIS program" per-relation, so the gate lives here —
    // mirrors events/[id] (#571); see docs/security/auth-consistency-analysis.md
    // §4 (principled exception) and §5.1a. The route stays `authorize: 'public'`
    // because the catalog metadata (name/price/dates/spots) drives the public
    // registration page; only the roster is gated.
    //
    // Staff (admin/board/lead/core-vol) or a member of an enrolled household see
    // the rows; everyone else (anonymous, plain authenticated non-enrolled) gets
    // metadata + counts only. The public details/enroll page needs spots-remaining
    // (_count.participants), not names — a count is fine, the names are the leak.
    // The registry orderedView tiers remain as defense-in-depth, stripping
    // pii/personal on the rows for non-staff-but-enrolled callers.
    const isEnrolled = !!sessionUser && program.participants.some(p =>
        p.personId === sessionUser.id ||
        (sessionUser.householdId != null && p.person?.householdId === sessionUser.householdId)
    );
    if (!isPrivileged && !isEnrolled) {
        const metadata: Record<string, unknown> = { ...program };
        delete metadata.volunteers;
        delete metadata.participants;
        return { Program: metadata };
    }

    return { Program: program };
});


// withAuth rejects unauthenticated AND denied households at admission (closes
// GAP-1: this PATCH previously had no denied check), so a denied lead mentor can
// no longer edit their program.
export const PATCH = withAuth({}, async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await ctx.params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return apiError("Invalid program ID", 400);
        }

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return apiError("Program not found", 404);
        }

        const user = auth.user;
        const isLeadMentor = currentProgram.leadMentorId === user.id;
        const isSysAdminOrBoard = user.isSysadmin || user.isBoardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return apiError("Forbidden: Only Admin, Board Members, or Lead Mentors can edit", 403);
        }

        const body = await req.json();
        let { leadMentorId } = body;
        const { name, startAt, endAt, orgMemberOnly, announceOnOpen, phase, enrollmentStatus, minAge, maxAge, maxParticipants, leadMentorNotificationSettings, memberPrice, nonMemberPrice, shopifyProductId, shopifyVariantId } = body;

        if (body.hasOwnProperty('leadMentorId')) {
            if (!leadMentorId) {
                return apiError("Lead Mentor is required", 400);
            }
            leadMentorId = parseInt(leadMentorId);
            if (isNaN(leadMentorId)) {
                return apiError("Invalid lead mentor", 400);
            }
            if (!isSysAdminOrBoard && leadMentorId !== currentProgram.leadMentorId) {
                return apiError("Forbidden: Only administrators can reassign lead mentors", 403);
            }
        }

        if (announceOnOpen !== undefined && typeof announceOnOpen !== "boolean") {
            return apiError("announceOnOpen must be a boolean", 400);
        }
        if (phase !== undefined && !Object.values(ProgramPhase).includes(phase)) {
            return apiError("Invalid phase", 400);
        }
        if (enrollmentStatus !== undefined && !Object.values(EnrollmentStatus).includes(enrollmentStatus)) {
            return apiError("Invalid enrollmentStatus", 400);
        }

        // Use effective values (body overrides current) so a one-sided edit
        // can't leave minAge > maxAge or exceed the 25+ ceiling.
        const effMinAge = minAge !== undefined ? minAge : currentProgram.minAge;
        const effMaxAge = maxAge !== undefined ? maxAge : currentProgram.maxAge;
        const ageErr = validateProgramAgeBounds(effMinAge, effMaxAge);
        if (ageErr) {
            return apiError(ageErr, 400);
        }

        if (maxParticipants !== undefined && maxParticipants !== null) {
            if (typeof maxParticipants !== "number" || !Number.isInteger(maxParticipants) || maxParticipants <= 0) {
                return apiError("maxParticipants must be a positive integer", 400);
            }
            const enrolled = await prisma.programParticipant.count({ where: { programId, person: LIVE_PERSON } });
            if (maxParticipants < enrolled) {
                return apiError(`maxParticipants cannot be set below the current enrollment of ${enrolled}`, 400);
            }
        }

        const updateData: Record<string, unknown> = {
            ...(name !== undefined && { name }),
            ...(leadMentorId !== undefined && { leadMentorId }),
            ...(startAt !== undefined && { startAt: parseDateOnly(startAt) }),
            ...(endAt !== undefined && { endAt: parseDateOnly(endAt) }),
            ...(orgMemberOnly !== undefined && { orgMemberOnly }),
            ...(announceOnOpen !== undefined && { announceOnOpen }),
            ...(phase !== undefined && { phase }),
            ...(enrollmentStatus !== undefined && { enrollmentStatus }),
            ...(minAge !== undefined && { minAge }),
            ...(maxAge !== undefined && { maxAge }),
            ...(maxParticipants !== undefined && { maxParticipants }),
            ...(leadMentorNotificationSettings !== undefined && { leadMentorNotificationSettings }),
            ...(memberPrice !== undefined && { orgMemberPriceCents: dollarsToCentsOrNull(memberPrice != null ? String(memberPrice) : undefined) }),
            ...(nonMemberPrice !== undefined && { nonOrgMemberPriceCents: dollarsToCentsOrNull(nonMemberPrice != null ? String(nonMemberPrice) : undefined) }),
            // Shopify identifiers are sysadmin/board-only — a lead mentor's PATCH can't
            // touch them (they can break checkout, so they stay off the lead surface).
            // Empty string clears the field. This is the manual repair path when there's
            // no live Shopify to sync against (local/testing).
            ...(isSysAdminOrBoard && shopifyProductId !== undefined && { shopifyProductId: shopifyProductId || null }),
            ...(isSysAdminOrBoard && shopifyVariantId !== undefined && { shopifyVariantId: shopifyVariantId || null }),
        };

        const updatedProgram = await prisma.program.update({
            where: { id: programId },
            data: updateData
        });

        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: 'EDIT',
                tableName: 'Program',
                affectedEntityId: updatedProgram.id,
                oldData: currentProgram,
                newData: updatedProgram
            }
        });

        // Announce trigger — transition rule, once-per-lifetime claim, audit row,
        // and fire-without-await all live in the helper. Never throws.
        await maybeAnnounceOnOpen({
            programId: updatedProgram.id,
            before: currentProgram,
            after: updatedProgram,
            actorId: auth.user.id,
        });

        // Shopify is the source of truth for program capacity (product decision
        // 2026-07-06): cap edits propagate as relative inventory adjustments.
        // Only fires when the program already has Shopify checkout wired up —
        // creation and sync-shopify set inventory absolutely and are unaffected.
        let warning: string | undefined;
        const oldMax = currentProgram.maxParticipants;
        const newMax = updatedProgram.maxParticipants;
        const hasShopifyVariant = !!updatedProgram.shopifyVariantId;

        if (oldMax !== newMax && hasShopifyVariant) {
            if (oldMax !== null && newMax !== null) {
                const ok = await adjustProgramInventory(updatedProgram, newMax - oldMax);
                if (!ok) {
                    warning = "Program updated, but the Shopify inventory adjustment failed. Capacity may be out of sync — check System Status > Link Status.";
                }
            } else {
                // Null transition (capped <-> uncapped): a relative adjust can't express
                // "start/stop tracking inventory" — that needs an inventory_management
                // flip on the variant, which this PR intentionally doesn't attempt.
                logger.warn(`[SHOPIFY] Program ${updatedProgram.id} maxParticipants transitioned ${oldMax} -> ${newMax} (capped/uncapped); inventory not adjusted automatically.`);
                warning = "Capacity changed between capped and uncapped. Shopify inventory was not updated automatically — run Sync to Shopify or edit inventory directly in Shopify.";
            }
        }

        const responseObj: Record<string, unknown> = { success: true, program: updatedProgram };
        if (warning) responseObj.warning = warning;
        return NextResponse.json(responseObj);
    } catch (error) {
        logger.error("Program update error:", error);
        return apiError("Failed to update program", 500);
    }
});
