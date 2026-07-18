import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { createParticipantWithHousehold } from "@/lib/auth-options";
import { isValidEmail } from "@/lib/emergencyContacts/identity";
import { normalizeEmail } from "@/lib/prismaEmailNormalize";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

// Email-only contact creation for Board. Sysadmin is deliberately EXCLUDED
// (Jeff's decision; same board-only shape as Finance Ops #1083) — do NOT add
// 'isSysadmin' here. Operations joins this endpoint in a follow-up PR once the
// RBAC rework (the isOperations role) merges.
export const POST = withAuth({ roles: ['isBoardMember'] }, async (req, auth) => {
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
        // Deliberate, not a leak: every caller role here (board) is already
        // trusted with the full people directory and can look up this same
        // name+email via people/search. The 409 reveals nothing they can't already
        // query. Flagged for future audits — do not redact.
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

        return NextResponse.json({ success: true, participant: person });
    } catch (error) {
        await logBackendError(error, "POST /api/membership-ops/contacts");
        return apiError("Failed to create contact", 500);
    }
});
