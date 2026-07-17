import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth, authenticateRequest } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { handler, notFound, forbidden, badRequest } from "@/security/handler";
import { isActiveOrgMember, isActiveOrgMemberThrough, programCoverageDate } from "@/lib/orgMembership";
import { notifyNewProgramAnnounced } from "@/lib/notifications";
import { adjustProgramInventory } from "@/lib/shopify";
import { dollarsToCentsOrNull } from "@inventory/money";
import { apiError } from "@/lib/api-response";
import { validateProgramAgeBounds } from "@/lib/programAge";

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
    const [viewerIsMember, viewerMemberPricingEligible] = await Promise.all([
        isActiveOrgMember(auth.user.id),
        isActiveOrgMemberThrough(auth.user.id, coverageDate),
    ]);
    return NextResponse.json({ ...body, viewerIsMember, viewerMemberPricingEligible });
}

const getProgram = handler<{ id: string }>('GET /api/programs/[id]', async ({ auth, params }) => {
    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) throw badRequest('Invalid program ID');

    const program = await prisma.program.findUnique({
        where: { id: programId },
        include: {
            volunteers: { include: { person: true } },
            participants: {
                include: {
                    person: {
                        include: {
                            household: {
                                include: {
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
            events: { orderBy: { startAt: 'asc' } },
            fees: true,
            leadMentor: true,
            _count: { select: { participants: true, volunteers: true } },
        },
    });

    if (!program) throw notFound('Program not found');

    const isSessionUser = auth.type === 'session';
    const sessionUser = isSessionUser ? auth.user : undefined;
    const isSysAdminOrBoard = !!(sessionUser?.isSysadmin || sessionUser?.isBoardMember);
    const isLeadMentor = !!sessionUser && sessionUser.id === program.leadMentorId;
    const isCoreVolunteer = !!sessionUser && program.volunteers.some(v => v.personId === sessionUser.id && v.isCore);
    const isPrivileged = isSysAdminOrBoard || isLeadMentor || isCoreVolunteer;

    if (program.orgMemberOnly && !isPrivileged) {
        if (!sessionUser) throw notFound('Program not found');
        const hasActiveMembership = await isActiveOrgMember(sessionUser.id);
        if (!hasActiveMembership) throw forbidden('Forbidden: Member-Only Program');
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
        const { name, startAt, endAt, orgMemberOnly, phase, enrollmentStatus, minAge, maxAge, maxParticipants, leadMentorNotificationSettings, memberPrice, nonMemberPrice, shopifyProductId, shopifyVariantId, shopifyOrgMemberVariantId, shopifyNonOrgMemberVariantId } = body;

        if (body.hasOwnProperty('leadMentorId')) {
            if (!leadMentorId) {
                return apiError("Lead Mentor is required", 400);
            }
            leadMentorId = parseInt(leadMentorId);
            if (isNaN(leadMentorId)) {
                return apiError("Invalid lead mentor", 400);
            }
        }

        const ageErr = validateProgramAgeBounds(minAge, maxAge);
        if (ageErr) {
            return apiError(ageErr, 400);
        }

        const updateData: Record<string, unknown> = {
            ...(name !== undefined && { name }),
            ...(leadMentorId !== undefined && { leadMentorId }),
            ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
            ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
            ...(orgMemberOnly !== undefined && { orgMemberOnly }),
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
            ...(isSysAdminOrBoard && shopifyOrgMemberVariantId !== undefined && { shopifyOrgMemberVariantId: shopifyOrgMemberVariantId || null }),
            ...(isSysAdminOrBoard && shopifyNonOrgMemberVariantId !== undefined && { shopifyNonOrgMemberVariantId: shopifyNonOrgMemberVariantId || null }),
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

        // Announce only on the transition INTO (UPCOMING && OPEN) — not on every
        // save while already there, and not when only one of the two is set.
        const wasAnnounced = currentProgram.phase === 'UPCOMING' && currentProgram.enrollmentStatus === 'OPEN';
        const nowAnnounced = updatedProgram.phase === 'UPCOMING' && updatedProgram.enrollmentStatus === 'OPEN';
        if (!wasAnnounced && nowAnnounced) {
            await notifyNewProgramAnnounced(updatedProgram.name);
        }

        // Shopify is the source of truth for program capacity (product decision
        // 2026-07-06): cap edits propagate as relative inventory adjustments.
        // Only fires when the program already has Shopify checkout wired up —
        // creation and sync-shopify set inventory absolutely and are unaffected.
        let warning: string | undefined;
        const oldMax = currentProgram.maxParticipants;
        const newMax = updatedProgram.maxParticipants;
        const hasShopifyVariant = !!(updatedProgram.shopifyVariantId || updatedProgram.shopifyOrgMemberVariantId || updatedProgram.shopifyNonOrgMemberVariantId);

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
