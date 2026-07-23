import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { isActiveOrgMember, isActiveOrgMemberThrough, programCoverageDate } from "@/lib/orgMembership";
import { mintMemberDiscountCode } from "@/lib/shopify";

// Server-minted, single-use member discount code for a single-pool program's
// checkout link (see mintMemberDiscountCode in lib/shopify.ts). Recomputes
// membership from the session server-side — never trusts a client-supplied
// "I'm a member" flag for a pricing decision. Always 200s with { code: null }
// when a discount doesn't apply (not a member / legacy program / mint
// failure) — the caller falls back to an undiscounted checkout link and never
// blocks checkout on this route.
export const POST = withAuth({}, async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await params;
    const programId = parseInt(id, 10);
    if (isNaN(programId)) return apiError("Invalid program ID", 400);

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) return apiError("Program not found", 404);

    // Legacy (two-variant) programs already charge the right tier via variant
    // choice — no discount code needed. Both prices must be known to compute
    // the discount amount.
    if (!program.shopifyVariantId || program.orgMemberPriceCents == null || program.nonOrgMemberPriceCents == null) {
        return NextResponse.json({ code: null });
    }

    const isMemberNow = await isActiveOrgMember(auth.user.id);
    if (!isMemberNow) return NextResponse.json({ code: null });

    // A current member isn't necessarily covered for the program's WHOLE run — a
    // not-yet-renewed household is valid only through the upcoming membership-year
    // boundary, so a program ending after that boundary must charge full price.
    const covers = await isActiveOrgMemberThrough(auth.user.id, programCoverageDate(program));
    if (!covers) return NextResponse.json({ code: null, reason: "membership_ends_before_program" });

    const amountOffCents = program.nonOrgMemberPriceCents - program.orgMemberPriceCents;
    if (amountOffCents <= 0) return NextResponse.json({ code: null });

    const code = await mintMemberDiscountCode(programId, program.shopifyVariantId, amountOffCents);
    return NextResponse.json({ code });
});
