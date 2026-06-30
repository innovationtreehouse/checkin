import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";

// SECURITY — deliberately on withAuth(), NOT the handler() field-stripper
// (audit buckets this under P0-B4e). This is the front-desk board-contact sheet:
// every admitted role (sysadmin | boardMember | keyholder) legitimately needs
// the board members' name + phone + email to reach the board — the negative-authz
// suite asserts a keyholder is admitted. The payload carries no board-only field
// (no DOB, address, or internal note), so the audience is uniformly entitled and
// per-field stripping has nothing to remove. Worse: routing keyholders through a
// non-PII view would strip the very phone/email the page exists to surface,
// breaking the endpoint's purpose. This is the exact twin of
// GET /api/safety/emergency-contacts (P0-B4a, also left on withAuth for the same
// reason). If the board ever rules keyholders may see names but NOT phone/email,
// revisit and migrate (keyholder -> member,public; sysadmin/board -> everyones:*).
// See docs/designs/p0-b4a-household-handler-migration.md.
export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember', 'keyholder'] },
    async () => {
        try {
            const members = await prisma.participant.findMany({
                where: { boardMember: true },
                select: { id: true, name: true, phone: true, email: true },
                orderBy: { name: "asc" },
            });
            return NextResponse.json({ members });
        } catch (error) {
            await logBackendError(error, "GET /api/safety/board-contacts");
            return NextResponse.json(
                { error: "Internal Server Error fetching board contacts." },
                { status: 500 }
            );
        }
    }
);
