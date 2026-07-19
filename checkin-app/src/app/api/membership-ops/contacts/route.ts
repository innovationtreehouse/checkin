import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { createParticipantWithHousehold } from "@/lib/auth-options";
import { isValidEmail } from "@/lib/emergencyContacts/identity";
import { normalizeEmail } from "@/lib/prismaEmailNormalize";
import { rolesToFlags } from "@/lib/roles";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

// Email-only contact creation for Board + Operations. Sysadmin is deliberately
// EXCLUDED (Jeff's decision; same board-only shape as Finance Ops #1083) — do
// NOT add 'isSysadmin' here.
export const POST = withAuth({ roles: ['isBoardMember', 'isOperations'] }, async (req, auth) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    try {
        const { name, email } = await req.json();

        if (!name || typeof name !== 'string' || !name.trim()) return apiError("Name is required", 400);
        if (!email || !isValidEmail(email)) return apiError("A valid email is required", 400);

        // Dup check MUST normalize the key the same way the write extension lowercases
        // (prismaEmailNormalize.ts) — else a case-variant misses here and 500s on the
        // @unique constraint instead of returning this owner-named 409.
        const existing = await prisma.person.findUnique({
            where: { email: normalizeEmail(email) },
            select: { name: true },
        });
        // Deliberate, not a leak: every caller role here (board + operations) is
        // already trusted with a people/search view that includes name+email —
        // board sees the full directory, and ops's stripped view (no background-check
        // dates, no membership/finance standing) still surfaces name+email for every
        // record. The 409 reveals nothing either caller couldn't already query.
        // Flagged for future audits — do not redact.
        if (existing) {
            return NextResponse.json(
                { error: `This email already belongs to ${existing.name ?? 'an existing account'}`, fields: ["email"] },
                { status: 409 },
            );
        }

        const person = await createParticipantWithHousehold({ name: name.trim(), email });

        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: "CREATE",
                tableName: "Person",
                affectedEntityId: person.id,
                secondaryAffectedEntity: person.householdId,
                newData: { name: person.name, email: person.email },
            },
        });

        // Re-fetch with household included so the client's optimistic prepend can
        // render the household name immediately, without a full-list refetch. A
        // brand-new contact holds no PersonRole rows, so the role flags are all
        // false — stamp them explicitly (rolesToFlags([])) rather than relying on
        // the raw Person row's mirror columns, which don't cover isOperations (it
        // has none), so the prepended row carries the same five flags as every row
        // that came from /api/people/search instead of a partially-shaped one.
        const participant = await prisma.person.findUnique({
            where: { id: person.id },
            include: { household: true },
        });

        return NextResponse.json({
            success: true,
            participant: { ...participant, ...rolesToFlags([]) },
        });
    } catch (error) {
        await logBackendError(error, "POST /api/membership-ops/contacts");
        return apiError("Failed to create contact", 500);
    }
});
