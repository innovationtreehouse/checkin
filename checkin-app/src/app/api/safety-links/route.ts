import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { createSafetyLink, SafetyLinkError } from "@/lib/safety-link/service";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<SafetyLinkError["code"], number> = {
    not_found: 404,
    bad_input: 400,
    wrong_phase: 409,
    forbidden: 403,
    already_open: 409,
};

interface Body {
    subjectParticipantId?: number;
    counterpartyParticipantId?: number | null;
    counterpartyName?: string | null;
    counterpartyContact?: string | null;
    relationshipType?: string;
    description?: string;
}

/**
 * POST /api/safety-links — disclose a dual relationship.
 *
 * A signed-in member/visitor discloses about themselves (subject defaults to the
 * caller). Board/sysadmin may enter on another's behalf by passing
 * subjectParticipantId (recorded as STAFF_ENTERED). The kiosk may submit on
 * behalf of a participant it identifies by subjectParticipantId.
 */
export const POST = withAuth({ allowKiosk: true }, async (req, auth) => {
    let body: Body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.relationshipType || !body.description) {
        return NextResponse.json({ error: "relationshipType and description are required" }, { status: 400 });
    }

    let subjectParticipantId: number | undefined;
    let disclosedById = 0;
    let origin: "SELF_DISCLOSED" | "STAFF_ENTERED" = "SELF_DISCLOSED";

    if (auth.type === "session") {
        disclosedById = auth.user.id;
        const isStaff = auth.user.boardMember || auth.user.sysadmin;
        if (body.subjectParticipantId && body.subjectParticipantId !== auth.user.id) {
            if (!isStaff) {
                return NextResponse.json({ error: "You may only disclose relationships about yourself." }, { status: 403 });
            }
            subjectParticipantId = body.subjectParticipantId;
            origin = "STAFF_ENTERED";
        } else {
            subjectParticipantId = auth.user.id;
        }
    } else {
        // kiosk
        if (!body.subjectParticipantId) {
            return NextResponse.json({ error: "subjectParticipantId is required" }, { status: 400 });
        }
        subjectParticipantId = body.subjectParticipantId;
    }

    try {
        const link = await createSafetyLink({
            subjectParticipantId: subjectParticipantId!,
            counterpartyParticipantId: body.counterpartyParticipantId ?? null,
            counterpartyName: body.counterpartyName ?? null,
            counterpartyContact: body.counterpartyContact ?? null,
            relationshipType: body.relationshipType,
            description: body.description,
            origin,
            disclosedById,
        });
        return NextResponse.json({ id: link.id }, { status: 201 });
    } catch (error) {
        if (error instanceof SafetyLinkError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
        }
        console.error("Safety link create error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
