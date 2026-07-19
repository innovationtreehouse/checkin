import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { nextBoundary } from "@/lib/membership/renewal";
import { substituteTokens, findUnknownTokens } from "@/lib/outreach/tokens";
import { sign } from "@/lib/outreach/unsubscribeToken";

export { findUnknownTokens };

export type OutreachVariant = "join" | "renew";
export type EmailType = "opening" | "reminder";

/** The board's current subject/body for one campaign template (BoardSettings singleton). */
export async function loadTemplate(emailType: EmailType): Promise<{ subject: string; body: string }> {
    const settings = await prisma.boardSettings.findUnique({
        where: { id: 1 },
        select: {
            outreachOpeningSubject: true,
            outreachOpeningBody: true,
            outreachReminderSubject: true,
            outreachReminderBody: true,
        },
    });
    return emailType === "opening"
        ? { subject: settings?.outreachOpeningSubject ?? "", body: settings?.outreachOpeningBody ?? "" }
        : { subject: settings?.outreachReminderSubject ?? "", body: settings?.outreachReminderBody ?? "" };
}

/** Thrown by {@link resolveBoundary} when the board hasn't configured the membership-year
 * boundary. `{{deadline}}` has nothing to render, so create-send blocks on this, surfacing
 * one clear error in the confirm dialog rather than a per-item failure mid-drain. */
export class BoundaryNotSetError extends Error {
    constructor() {
        super("Set the membership-year boundary (Settings → Membership) before sending.");
        this.name = "BoundaryNotSetError";
    }
}

/** The next occurrence of the board's configured membership-year boundary, or throws. */
export async function resolveBoundary(now: Date): Promise<Date> {
    const settings = await prisma.boardSettings.findUnique({
        where: { id: 1 },
        select: { orgMembershipYearBoundary: true },
    });
    if (!settings?.orgMembershipYearBoundary) throw new BoundaryNotSetError();
    return nextBoundary(settings.orgMembershipYearBoundary, now);
}

export interface RenderContext {
    name: string;
    variant: OutreachVariant;
    /** Resolved via {@link resolveBoundary} — computed ONCE per send, not per item. */
    boundary: Date;
    /** Needed to build the join-variant unsubscribe footer link. Omit for a preview/test
     * render that has no real recipient (falls back to no footer). */
    personId?: number;
}

/**
 * Render one recipient's subject+html from the board's template. `{{actionLink}}` is
 * `/membership` for BOTH variants (see spec §2.3 pin justification) — only
 * `{{actionWord}}` differs. The join variant gets an unsubscribe footer appended AFTER
 * token substitution (so the footer link itself is never subject to token rewriting);
 * renew carries no footer (renewal emails don't offer to unsubscribe from invitations).
 */
export function renderOutreachEmail(
    subjectTemplate: string,
    bodyTemplate: string,
    ctx: RenderContext,
): { subject: string; html: string } {
    const tokenCtx = {
        name: ctx.name,
        deadline: ctx.boundary.toISOString().slice(0, 10),
        actionWord: ctx.variant === "renew" ? "renew" : "join",
        actionLink: `${config.baseUrl()}/membership`,
    };
    const subject = substituteTokens(subjectTemplate, tokenCtx);
    let html = substituteTokens(bodyTemplate, tokenCtx);
    if (ctx.variant === "join" && ctx.personId != null) {
        html += unsubscribeFooter(ctx.personId);
    }
    return { subject, html };
}

function unsubscribeFooter(personId: number): string {
    const sig = sign(personId);
    const url = `${config.baseUrl()}/api/unsubscribe?p=${personId}&sig=${encodeURIComponent(sig)}`;
    return `<p><a href="${url}">Unsubscribe from invitations</a></p>`;
}
