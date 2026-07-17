import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { hasHouseholdConflict } from "@/lib/conflictOfInterest";
import { renewalSeasonWindow, nextBoundary, bgValidUntilBoundary, grantRenewalPayment } from "@/lib/membership/renewal";
import { grantableRenewalWhere, settledThisCycleWhere } from "@/lib/membership/lifecycle";
import { PaymentError } from "@/lib/membership/payment";

export const dynamic = 'force-dynamic';

// Emergency contacts are their own entity now; the admin editor still works in
// terms of a single primary contact, so map the household's primary valid contact
// back onto the flat emergencyContactName/Phone shape the client expects. Include
// it inline (below) with this where/order so Prisma infers the result type.
const PRIMARY_CONTACT_WHERE = { conflictParticipantId: null, name: { not: "" }, phone: { not: "" } };

// "Valid until" is DERIVED, never stored (thpr's #1053 review): a membership is
// exactly one year, so an active membership is valid until the UPCOMING year
// boundary, and a household already settled for the coming cycle is valid until
// the boundary after that. Deriving keeps it consistent with everything else the
// boundary drives (renewal sweep, 60-day warnings) with nothing to hand-update.
function derivedValidUntil(boundary: Date | null, settled: boolean): Date | null {
    if (!boundary) return null;
    return settled ? new Date(Date.UTC(boundary.getUTCFullYear() + 1, boundary.getUTCMonth(), boundary.getUTCDate())) : boundary;
}
function withFlatContact<T extends { emergencyContacts: { name: string; phone: string }[] }>(h: T) {
    const primary = h.emergencyContacts[0] ?? null;
    const { emergencyContacts: _drop, ...rest } = h;
    void _drop;
    return { ...rest, emergencyContactName: primary?.name ?? null, emergencyContactPhone: primary?.phone ?? null };
}

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req) => {
        try {
            const url = new URL(req.url);
            const id = url.searchParams.get('id');
            const q = url.searchParams.get('q') || '';

            if (id) {
                const household = await prisma.household.findUnique({
                    where: { id: parseInt(id) },
                    include: {
                        householdMembers: {
                            select: {
                                id: true, name: true, email: true, isHouseholdLead: true, lastBackgroundCheck: true,
                                // Program enrollments for the household detail view. Extra field the
                                // Edit Info modal (same endpoint) simply ignores.
                                programParticipants: {
                                    select: { status: true, program: { select: { id: true, name: true } } },
                                    orderBy: { program: { name: "asc" } },
                                },
                            }
                        },
                        orgMembership: true,
                        emergencyContacts: {
                            where: PRIMARY_CONTACT_WHERE,
                            orderBy: [{ priority: "asc" }, { id: "asc" }],
                            select: { name: true, phone: true },
                            take: 1,
                        },
                    }
                });
                if (!household) return NextResponse.json({ household: null });
                const householdLeads = household.householdMembers.filter(p => p.isHouseholdLead).map(p => ({ personId: p.id }));

                // ONE settings read serves the derived valid-until and the BG "valid until" calc below.
                const settings = await prisma.boardSettings.findUnique({
                    where: { id: 1 }, select: { orgMembershipYearBoundary: true, bgRecheckMonths: true },
                });
                const detailWindow = await renewalSeasonWindow(new Date());
                const detailBoundary = settings?.orgMembershipYearBoundary
                    ? nextBoundary(settings.orgMembershipYearBoundary, new Date())
                    : null;
                // "Settled this cycle" = a RENEWAL resolved (ACTIVE/ARCHIVED) inside the
                // window (fix #4, settledThisCycleWhere) — same test the list branch and
                // runRenewalSweep use, so a stray INITIAL activation no longer flips
                // derivedValidUntil a year forward. Out of season the window start is
                // "never" (matches nothing).
                const detailSettled = household.orgMembership
                    ? (await prisma.orgMembershipProcess.findFirst({
                          where: {
                              orgMembershipId: household.orgMembership.id,
                              ...settledThisCycleWhere(detailWindow?.windowStart ?? new Date(8.64e15)),
                          },
                          select: { id: true },
                      })) !== null
                    : false;
                const bgSettings = {
                    orgMembershipYearBoundary: settings?.orgMembershipYearBoundary ?? null,
                    bgRecheckMonths: settings?.bgRecheckMonths ?? 0,
                };
                // Per member — every member with a passed check (leads AND non-lead PERSON_BG
                // subjects alike); null when no check on file / policy unset.
                const membersWithBg = household.householdMembers.map((m) => ({
                    ...m,
                    bgValidUntil: bgValidUntilBoundary(m.lastBackgroundCheck, bgSettings),
                }));
                // Household level — the LATER lastBackgroundCheck among household leads who
                // passed (either lead's valid check covers the household).
                const latestLeadBg = household.householdMembers
                    .filter((m) => m.isHouseholdLead && m.lastBackgroundCheck)
                    .reduce<Date | null>((acc, m) => (!acc || m.lastBackgroundCheck! > acc ? m.lastBackgroundCheck! : acc), null);
                const householdBgValidUntil = bgValidUntilBoundary(latestLeadBg, bgSettings);

                return NextResponse.json({
                    household: { ...withFlatContact(household), householdMembers: membersWithBg, householdLeads, bgValidUntil: householdBgValidUntil },
                    validUntil: household.orgMembership?.status === "ACTIVE" ? derivedValidUntil(detailBoundary, detailSettled) : null,
                });
            }

            const whereClause = q ? {
                OR: [
                    { name: { contains: q, mode: 'insensitive' as const } },
                    { householdMembers: { some: { name: { contains: q, mode: 'insensitive' as const } } } },
                    { householdMembers: { some: { email: { contains: q, mode: 'insensitive' as const } } } },
                ]
            } : {};

            // Renewal-season probe input: the settled arm of the process include below
            // matches inside this window; out of season it matches nothing.
            const window = await renewalSeasonWindow(new Date());

            const households = await prisma.household.findMany({
                where: whereClause,
                include: {
                    householdMembers: {
                        // isHouseholdLead + lastBackgroundCheck drive the household-level "BG valid
                        // until" below. Board-only endpoint; lastBackgroundCheck rides along in the
                        // JSON at the same trust level as the rest of the row.
                        select: { id: true, name: true, email: true, isBoardMember: true, emailUndeliverableAt: true, isHouseholdLead: true, lastBackgroundCheck: true }
                    },
                    // ONE probe serves both flags computed below, from the shared lifecycle
                    // definitions: grantableRenewalWhere (payable renewal → grantability,
                    // fix #3) and settledThisCycleWhere (a RENEWAL resolved ACTIVE/ARCHIVED
                    // inside the renewal window → coming year settled, the same "handled this
                    // cycle" test runRenewalSweep uses, fix #4). Out of season the window
                    // start is "never" (matches no row), keeping one query shape and one
                    // inferred type. orgMembership's own scalars (status, memberSince) still
                    // ride along via this include.
                    orgMembership: {
                        include: {
                            processes: {
                                where: {
                                    OR: [
                                        grantableRenewalWhere,
                                        settledThisCycleWhere(window?.windowStart ?? new Date(8.64e15)),
                                    ],
                                },
                                select: { id: true, status: true },
                            },
                        },
                    },
                    emergencyContacts: {
                        where: PRIMARY_CONTACT_WHERE,
                        orderBy: [{ priority: "asc" }, { id: "asc" }],
                        select: { name: true, phone: true },
                        take: 1,
                    },
                },
                orderBy: {
                    id: 'desc'
                },
                ...(q && { take: 20 })
            });

            const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
            const boundary = settings?.orgMembershipYearBoundary
                ? nextBoundary(settings.orgMembershipYearBoundary, new Date())
                : null;
            const recheckMonths = settings?.bgRecheckMonths ?? 0;
            const bgSettings = { orgMembershipYearBoundary: settings?.orgMembershipYearBoundary ?? null, bgRecheckMonths: recheckMonths };

            const withGrantable = households.map((h) => {
                // Split the single OR probe by status: PENDING_PAYMENT = grantable renewal
                // (grantableRenewalWhere — any payable renewal; the grant comps payment and
                // BG stays an independent gate on ACTIVE, so no bgFresh gate); a terminal
                // ACTIVE/ARCHIVED renewal = the coming cycle is already settled
                // (settledThisCycleWhere: member finished renewal, admin override, or
                // board-archived this cycle).
                const { processes = [], ...orgMembership } = h.orgMembership ?? {};
                const renewalGrantable = processes.some((p) => p.status === "PENDING_PAYMENT");
                const settledForComingYear = processes.some((p) => p.status === "ACTIVE" || p.status === "ARCHIVED");
                // Household-level BG "valid until" — later lastBackgroundCheck among leads
                // who passed; no per-member values in the list response.
                const latestLeadBg = h.householdMembers
                    .filter((m) => m.isHouseholdLead && m.lastBackgroundCheck)
                    .reduce<Date | null>((acc, m) => (!acc || m.lastBackgroundCheck! > acc ? m.lastBackgroundCheck! : acc), null);
                const bgValidUntil = bgValidUntilBoundary(latestLeadBg, bgSettings);
                return {
                    ...withFlatContact(h),
                    orgMembership: h.orgMembership ? orgMembership : null,
                    renewalGrantable,
                    settledForComingYear,
                    bgValidUntil,
                    validUntil: h.orgMembership?.status === "ACTIVE" ? derivedValidUntil(boundary, settledForComingYear) : null,
                };
            });

            return NextResponse.json({
                households: withGrantable,
                renewalSeason: window !== null,
            });
        } catch (error) {
            logger.error("Failed to fetch households:", error);
            return apiError("Failed to fetch households", 500);
        }
    }
);

export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const body = await req.json();
            const { householdId, active, deny, comingYear, reason } = body;

            if (!householdId) {
                return apiError("Household ID is required", 400);
            }

            const existingMembership = await prisma.orgMembership.findUnique({
                where: { householdId }
            });

            // Deny / restore — a separate legal act from grant/revoke. Denying blocks login for
            // every member of the household (enforced in the auth layer).
            if (typeof deny === "boolean") {
                if (deny) {
                    // Two separate legal actions → two separate software actions: a household
                    // containing a board member cannot be denied. Remove the board role first.
                    // Enforced server-side; the UI's disabled button is only a courtesy.
                    const boardMemberInHousehold = await prisma.person.findFirst({
                        where: { householdId, isBoardMember: true },
                        select: { id: true }
                    });
                    if (boardMemberInHousehold) {
                        return apiError("This household includes a board member. Remove the board role before denying membership.", 409);
                    }
                }

                const newStatus = deny ? "DENIED" : "NONE";
                const membership = await prisma.orgMembership.upsert({
                    where: { householdId },
                    create: { householdId, status: newStatus },
                    update: { status: newStatus }
                });

                if (auth.type === 'session') {
                    await prisma.auditLog.create({
                        data: {
                            actorId: auth.user.id,
                            action: "EDIT",
                            tableName: "OrgMembership",
                            affectedEntityId: membership.id,
                            secondaryAffectedEntity: householdId,
                            oldData: { status: existingMembership?.status ?? "NONE" },
                            newData: { status: newStatus }
                        }
                    });
                }

                return NextResponse.json({ success: true, membership });
            }

            // Renewal-season admin override: complete the payment gate on a household's
            // in-flight RENEWAL that's already at PENDING_PAYMENT (contract signed) with
            // a valid, cleared background check — by delegating to the same settlement
            // path a real payment takes. No archive, no second process, no stamped gates.
            if (comingYear) {
                // Certify requires a real actor; mirror the settings PUT convention.
                if (auth.type !== "session") return apiError("Unauthorized", 401);
                const trimmedReason = typeof reason === "string" ? reason.trim() : "";
                if (!trimmedReason) return apiError("A reason is required to certify a payment", 400);
                try {
                    const process = await grantRenewalPayment(householdId, {
                        actorId: auth.user.id,
                        isSysadmin: auth.user.isSysadmin === true,
                        reason: trimmedReason,
                    });
                    return NextResponse.json({ success: true, process });
                } catch (e) {
                    if (e instanceof PaymentError) {
                        const status = e.code === "forbidden" ? 403 : e.code === "not_found" ? 404 : 409;
                        return apiError(e.message, status);
                    }
                    throw e; // unexpected → outer catch → 500
                }
            }

            if (active) {
                // Conflict of interest: a board member may not grant their OWN household
                // ACTIVE membership — that bypasses payment AND the background check for
                // their own family. Sysadmin bypasses. (Mirrors the deny branch's
                // board-member protection, and certifyPaymentPlan's guard.)
                if (auth.type === 'session' && await hasHouseholdConflict(prisma, auth.user.id, householdId, { isSysadmin: auth.user.isSysadmin === true })) {
                    return apiError("You cannot activate your own household's membership — a sysadmin must.", 403);
                }
                const membership = await prisma.orgMembership.upsert({
                    where: { householdId },
                    create: { householdId, status: "ACTIVE" },
                    update: { status: "ACTIVE" }
                });
                if (auth.type === 'session') {
                    await prisma.auditLog.create({
                        data: {
                            actorId: auth.user.id,
                            action: "EDIT",
                            tableName: "OrgMembership",
                            affectedEntityId: membership.id,
                            secondaryAffectedEntity: householdId,
                            oldData: { status: existingMembership?.status ?? "NONE" },
                            newData: { status: "ACTIVE" }
                        }
                    });
                }
                return NextResponse.json({ success: true, membership });
            } else if (existingMembership && existingMembership.status === "ACTIVE") {
                const membership = await prisma.orgMembership.update({
                    where: { householdId },
                    data: { status: "REVOKED" }
                });
                if (auth.type === 'session') {
                    await prisma.auditLog.create({
                        data: {
                            actorId: auth.user.id,
                            action: "EDIT",
                            tableName: "OrgMembership",
                            affectedEntityId: membership.id,
                            secondaryAffectedEntity: householdId,
                            oldData: { status: "ACTIVE" },
                            newData: { status: "REVOKED" }
                        }
                    });
                }
                return NextResponse.json({ success: true, message: "Membership deactivated" });
            }

            return NextResponse.json({ success: true, message: "No change needed" });
        } catch (error) {
            logger.error("Failed to update household membership:", error);
            return apiError("Failed to update membership", 500);
        }
    }
);
