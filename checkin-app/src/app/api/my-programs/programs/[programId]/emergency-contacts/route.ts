import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";
import { isWithinLeadAccessWindow, timeScopingMessage } from "@/lib/emergencyContacts/leadAccess";

/**
 * GET /api/my-programs/programs/[programId]/emergency-contacts
 *
 * Time-scoped, audited emergency-contact access for a program's LEAD mentor.
 * See docs/designs/LEAD_EMERGENCY_CONTACT_ACCESS.md.
 *
 * - Only the program's leadMentor may call it (off-roster → 403). Board/sysadmin
 *   keep the un-windowed /api/safety/emergency-contacts route (untouched).
 * - Access is limited to [startAt − 7d, endAt + 7d]; null dates fail closed.
 *   Outside the window (or null dates) → 403 with a message explaining the scoping.
 * - On success, one AuditLog READ row is written per household whose contacts are
 *   returned (per household-contacts view, NOT per contact).
 *
 * Explicit response shaping (the strict idiom): only public/personal contact
 * fields leave; internal fields (phoneDigits, conflictParticipantId, timestamps)
 * are never selected.
 */
export const GET = withAuth(
    {},
    async (_req, auth, { params }: { params: Promise<{ programId: string }> }) => {
        if (auth.type !== "session") return apiError("Unauthorized", 401);
        const programId = parseInt((await params).programId, 10);
        if (isNaN(programId)) return apiError("Invalid program id", 400);

        try {
            const program = await prisma.program.findUnique({
                where: { id: programId },
                select: {
                    id: true,
                    name: true,
                    leadMentorId: true,
                    startAt: true,
                    endAt: true,
                    participants: {
                        select: { person: { select: { id: true, name: true, householdId: true } } },
                    },
                },
            });
            if (!program) return apiError("Program not found", 404);

            // Off-roster: this is the lead surface only.
            if (program.leadMentorId !== auth.user.id) {
                return apiError("You can only view emergency contacts for programs you lead.", 403);
            }

            // Time-scope: fail closed on null dates, 403 outside the window.
            if (!isWithinLeadAccessWindow(new Date(), program.startAt, program.endAt)) {
                return apiError(timeScopingMessage(program.startAt, program.endAt), 403);
            }

            // Distinct households of the program's participants (siblings share one).
            const householdToPeople = new Map<number, string[]>();
            for (const p of program.participants) {
                const list = householdToPeople.get(p.person.householdId) ?? [];
                if (p.person.name) list.push(p.person.name);
                householdToPeople.set(p.person.householdId, list);
            }
            const householdIds = [...householdToPeople.keys()];

            const households = householdIds.length
                ? await prisma.household.findMany({
                      where: { id: { in: householdIds } },
                      select: {
                          id: true,
                          name: true,
                          emergencyContacts: {
                              where: { conflictParticipantId: null, name: { not: "" }, phone: { not: "" } },
                              orderBy: [{ priority: "asc" }, { id: "asc" }],
                              select: { id: true, name: true, phone: true, email: true, relationship: true },
                          },
                      },
                  })
                : [];

            // Audit: one READ row per household viewed (not per contact).
            if (households.length) {
                await prisma.auditLog.createMany({
                    data: households.map(h => ({
                        actorId: auth.user.id,
                        action: "READ" as const,
                        tableName: "EmergencyContact",
                        affectedEntityId: h.id,
                        secondaryAffectedEntity: program.id,
                    })),
                });
            }

            return NextResponse.json({
                program: { id: program.id, name: program.name },
                households: households.map(h => ({
                    householdId: h.id,
                    householdName: h.name,
                    participants: householdToPeople.get(h.id) ?? [],
                    contacts: h.emergencyContacts,
                })),
            });
        } catch (error) {
            await logBackendError(error, "GET /api/my-programs/programs/[programId]/emergency-contacts");
            return apiError("Internal Server Error fetching emergency contacts.", 500);
        }
    },
);
