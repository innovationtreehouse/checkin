// Slack Web API client — per-program bot token, channel invite/lookup/kick for the
// group-slack-sync feature. Plain `fetch` to slack.com; no SDK. One of the ONLY two
// files allowed to fetch Google/Slack (the other is ./googleGroups.ts) — see that
// file's header for the gateway-discipline rationale.
//
// Slack is per-program (each program has its own workspace bot token stored in
// ProgramSlackAuth), unlike Google Directory's single org-wide SA — so this client
// is minted fresh per call site from a caller-supplied token, not cached module-wide.
//
// Semantics (REVIEW ADDENDUM A2): Slack is warn-then-remove, not add-only.
// removeFromChannel (conversations.kick) exists for the reconcile's 7-day-after-warning
// removal step (lib/sync/apply.ts's applySlackRemoval). The bot needs `channels:manage`
// (public channels) / `groups:write` (private channels) in addition to the invite/lookup
// scopes for kick to work.

export interface SlackClient {
    lookupByEmail(email: string): Promise<SlackLookupResult>;
    /** Batches internally (Tier-3 rate limit, ~30 ids/call — see BATCH_SIZE below). */
    inviteToChannel(channelId: string, userIds: string[]): Promise<SlackOpResult>;
    removeFromChannel(channelId: string, userId: string): Promise<SlackOpResult>;
}

export type SlackLookupResult =
    | { ok: true; userId: string }
    | { ok: false; notFound: boolean; error?: string };

export type SlackOpResult =
    | { ok: true; alreadyInDesiredState?: boolean } // already_in_channel / not_in_channel tolerated
    | { ok: false; error: string; retryAfterMs?: number };

/** conversations.invite is Tier 3 (~50/min) — batch well under that per call. */
const BATCH_SIZE = 30;

const TOLERATED_INVITE_ERRORS = new Set(["already_in_channel", "cant_invite_self"]);

function retryAfterMs(res: Response): number {
    const seconds = Number(res.headers.get("retry-after"));
    return (Number.isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000;
}

/**
 * Factory: null when no bot token is configured for this program (per-program,
 * ProgramSlackAuth — looked up by the caller, not here).
 */
export function getSlackClient(
    botToken: string | null,
    deps?: { fetchFn?: typeof fetch },
): SlackClient | null {
    if (!botToken) return null;
    const fetchFn = deps?.fetchFn ?? globalThis.fetch;
    const headers = { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json; charset=utf-8" };

    return {
        async lookupByEmail(email: string): Promise<SlackLookupResult> {
            const res = await fetchFn(
                `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
                { headers },
            );
            const data = (await res.json()) as { ok: boolean; user?: { id: string }; error?: string };
            if (data.ok && data.user) return { ok: true, userId: data.user.id };
            if (data.error === "users_not_found") return { ok: false, notFound: true };
            return { ok: false, notFound: false, error: data.error ?? "users.lookupByEmail failed" };
        },

        async inviteToChannel(channelId: string, userIds: string[]): Promise<SlackOpResult> {
            if (userIds.length === 0) return { ok: true };
            let allTolerated = true;
            for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
                const batch = userIds.slice(i, i + BATCH_SIZE);
                const res = await fetchFn("https://slack.com/api/conversations.invite", {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ channel: channelId, users: batch.join(",") }),
                });
                if (res.status === 429) {
                    return { ok: false, error: "ratelimited", retryAfterMs: retryAfterMs(res) };
                }
                const data = (await res.json()) as {
                    ok: boolean;
                    error?: string;
                    errors?: Array<{ error?: string }>;
                };
                if (data.ok) {
                    allTolerated = false;
                    continue;
                }
                const perUserErrors = data.errors?.length ? data.errors.map((e) => e.error) : [data.error];
                const tolerated = perUserErrors.every((e) => !!e && TOLERATED_INVITE_ERRORS.has(e));
                if (!tolerated) {
                    return {
                        ok: false,
                        error: data.error || perUserErrors.filter(Boolean).join(", ") || "conversations.invite failed",
                    };
                }
            }
            return allTolerated ? { ok: true, alreadyInDesiredState: true } : { ok: true };
        },

        async removeFromChannel(channelId: string, userId: string): Promise<SlackOpResult> {
            const res = await fetchFn("https://slack.com/api/conversations.kick", {
                method: "POST",
                headers,
                body: JSON.stringify({ channel: channelId, user: userId }),
            });
            if (res.status === 429) {
                return { ok: false, error: "ratelimited", retryAfterMs: retryAfterMs(res) };
            }
            const data = (await res.json()) as { ok: boolean; error?: string };
            if (data.ok) return { ok: true };
            if (data.error === "not_in_channel") return { ok: true, alreadyInDesiredState: true };
            return { ok: false, error: data.error ?? "conversations.kick failed" };
        },
    };
}
