import prisma from "@/lib/prisma";
import { verify } from "@/lib/outreach/unsubscribeToken";
import { escapeHtml } from "@/lib/email-templates/base";

export const dynamic = "force-dynamic";

/**
 * /api/unsubscribe — public, session-less, self-verifying via the signed token (the
 * withCron/withWebhook/withKiosk family — see unsubscribeToken.ts). No withAuth, no
 * registry entry: `middleware.ts` already leaves `/api/*` ungated, and this route enforces
 * itself.
 *
 * GET renders a confirm page and does NOT flip the flag — mail scanners and link-preview
 * bots prefetch GET links, so flipping here would mass-unsubscribe people who never clicked
 * anything. POST (the confirm button's target) flips it. Bad/missing/tampered token → a
 * neutral "expired or invalid" page on GET, 400 on POST — no information leak either way.
 */

// Plain Response (not NextResponse) — this is a bare HTML page, not a Next-specific
// concern (cookies/rewrites), and the constructor form of NextResponse isn't used
// anywhere else in this codebase.
function page(body: string): Response {
    return new Response(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe</title></head>` +
            `<body style="font-family: sans-serif; max-width: 480px; margin: 15vh auto 0; padding: 0 24px; text-align: center;">${body}</body></html>`,
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
}

function invalidPage(): Response {
    return page(`<h1>Link expired or invalid</h1><p>This unsubscribe link is no longer valid.</p>`);
}

function parseParams(req: Request): { personId: number; sig: string } | null {
    const url = new URL(req.url);
    const p = url.searchParams.get("p");
    const sig = url.searchParams.get("sig");
    if (!p || !sig) return null;
    const personId = Number.parseInt(p, 10);
    if (!Number.isInteger(personId)) return null;
    return { personId, sig };
}

export async function GET(req: Request) {
    const parsed = parseParams(req);
    if (!parsed || !verify(parsed.personId, parsed.sig)) return invalidPage();

    const person = await prisma.person.findUnique({ where: { id: parsed.personId }, select: { email: true } });
    if (!person) return invalidPage();

    const actionUrl = `/api/unsubscribe?p=${parsed.personId}&sig=${encodeURIComponent(parsed.sig)}`;
    return page(`
        <h1>Stop membership invitation emails?</h1>
        <p>Stop membership invitation emails to ${escapeHtml(person.email ?? "")}?</p>
        <form method="POST" action="${actionUrl}">
            <button type="submit" style="font-size: 1rem; padding: 8px 20px; cursor: pointer;">Unsubscribe</button>
        </form>
    `);
}

export async function POST(req: Request) {
    const parsed = parseParams(req);
    if (!parsed || !verify(parsed.personId, parsed.sig)) return invalidPage();

    const person = await prisma.person.findUnique({ where: { id: parsed.personId }, select: { id: true } });
    if (!person) return invalidPage();

    // Idempotent — already-suppressed is fine, no separate branch needed.
    await prisma.person.update({ where: { id: parsed.personId }, data: { emailSuppressed: true } });
    return page(`<h1>You're unsubscribed.</h1><p>You won't receive further membership invitation emails.</p>`);
}
