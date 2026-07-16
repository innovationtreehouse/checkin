import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { pingDatabase } from "@/lib/prisma";

/**
 * DB wake probe for DbWakeNotice: answers "is the database awake right now?"
 * quickly (retry-free pool ping raced against a short timeout) so the banner
 * can explain the ~30s Aurora auto-pause resume instead of letting a cold
 * visit read as a broken app.
 *
 * Session-gated on purpose: an anonymous SELECT-1 endpoint would let any
 * crawler wake (and keep waking) the auto-pausing cluster — the exact cost
 * this UX exists to accommodate. Returns no data beyond the boolean.
 */
export const GET = withAuth({}, async () => {
    const ok = await pingDatabase();
    if (ok) {
        return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(
        { ok: false, waking: true },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
    );
});
