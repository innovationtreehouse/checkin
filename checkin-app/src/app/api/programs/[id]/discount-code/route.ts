import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { isActiveOrgMember } from "@/lib/orgMembership";
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

    // Archived listing (SHOPIFY_LISTING_ARCHIVE.md): no live listing to price —
    // treat like a legacy/free program and fall through to an undiscounted link.
    if (program.shopifyArchivedAt) return NextResponse.json({ code: null });

    // Legacy (two-variant) programs already charge the right tier via variant
    // choice — no discount code needed. Both prices must be known to compute
    // the discount amount.
    if (!program.shopifyVariantId || program.orgMemberPriceCents == null || program.nonOrgMemberPriceCents == null) {
        return NextResponse.json({ code: null });
    }

    const isMember = await isActiveOrgMember(auth.user.id);
    if (!isMember) return NextResponse.json({ code: null });

    const amountOffCents = program.nonOrgMemberPriceCents - program.orgMemberPriceCents;
    if (amountOffCents <= 0) return NextResponse.json({ code: null });

    const code = await mintMemberDiscountCode(programId, program.shopifyVariantId, amountOffCents);
    return NextResponse.json({ code });
});
