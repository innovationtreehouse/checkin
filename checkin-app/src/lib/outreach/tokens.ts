import { escapeHtml } from "@/lib/email-templates/base";

/**
 * Token substitution shared by the server-side render path (lib/outreach/render.ts)
 * and the settings/outreach page's live client preview. Dependency-free (just
 * escapeHtml, itself dependency-free) so it is safe to import from a "use client"
 * component without pulling prisma/crypto into the browser bundle — the ONE source
 * of substitution logic means the preview can never drift from what actually sends.
 */

export const ALLOWED_TOKENS = ["name", "deadline", "actionWord", "actionLink"] as const;
const ALLOWED_TOKEN_SET = new Set<string>(ALLOWED_TOKENS);

const TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g;

/** Every `{{token}}` name in `text` that is not one of the four legal tokens. */
export function findUnknownTokens(text: string): string[] {
    const found = new Set<string>();
    for (const m of text.matchAll(TOKEN_RE)) {
        if (!ALLOWED_TOKEN_SET.has(m[1])) found.add(m[1]);
    }
    return [...found];
}

export interface TokenContext {
    /** Pre-escaped or plain — substituteTokens escapes name itself, so pass raw. */
    name: string;
    deadline: string;
    actionWord: string;
    actionLink: string;
}

/** Replace the four legal tokens; `{{name}}` is HTML-escaped, the rest are plain strings the caller controls. */
export function substituteTokens(template: string, ctx: TokenContext): string {
    return template.replace(TOKEN_RE, (whole, name: string) => {
        switch (name) {
            case "name": return escapeHtml(ctx.name);
            case "deadline": return ctx.deadline;
            case "actionWord": return ctx.actionWord;
            case "actionLink": return ctx.actionLink;
            default: return whole; // unknown token — left as-is; save-time validation rejects these
        }
    });
}
