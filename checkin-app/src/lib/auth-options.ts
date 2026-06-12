import { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getToken } from "next-auth/jwt";
import { cookies as requestCookies } from "next/headers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import { config, ORG_DOMAIN } from "@/lib/config";
import { evaluateMint, type MintMode } from "@/lib/impersonation";
import { recordLedger } from "@/lib/dev/ledger";

// Stable id for the dev/local persona-mint credential flow.
export const PERSONA_MINT_PROVIDER_ID = "persona-mint";

// NextAuth PrismaAdapter hardcodes `prisma.user` for its user operations.
// We map `.user` to `.participant` so the adapter can find our custom model.
const prismaAdapterCore = prisma as unknown as Record<string, unknown> & { participant: unknown };
const prismaAdapterClient = {
    ...prismaAdapterCore,
    user: prismaAdapterCore.participant,
};

// Every participant must belong to a household (Participant.householdId is
// required), so new sign-ups get a single-person household they lead.
async function createParticipantWithHousehold(data: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    googleId?: string | null;
    emailVerified?: Date | null;
}) {
    return prisma.$transaction(async (tx) => {
        const household = await tx.household.create({
            data: { name: data.name ?? data.email ?? null },
        });
        const participant = await tx.participant.create({
            data: { ...data, householdId: household.id },
        });
        await tx.householdLead.create({
            data: { householdId: household.id, participantId: participant.id },
        });
        return participant;
    });
}

// Wrap the adapter so `getUser` can handle string IDs from CredentialsProvider.
// NextAuth always coerces IDs to strings, but our Participant.id is an Int.
// `createUser` is overridden so first sign-in also creates the household.
const baseAdapter = PrismaAdapter(prismaAdapterClient) as unknown as Record<string, unknown>;
const patchedAdapter = {
    ...baseAdapter,
    createUser: async (user: Parameters<typeof createParticipantWithHousehold>[0]) => {
        const created = await createParticipantWithHousehold(user);
        return { ...created, id: String(created.id), email: created.email || "" };
    },
    getUser: async (id: string) => {
        const numericId = parseInt(id, 10);
        if (isNaN(numericId)) return null;
        const user = await prisma.participant.findUnique({ where: { id: numericId } });
        return user ? { ...user, id: String(user.id), email: user.email || "" } : null;
    },
};

// Bootstrap sysadmin emails — comma-separated list from env.
// Any account matching these emails will be auto-promoted to sysadmin on login.
const BOOTSTRAP_SYSADMINS = (process.env.BOOTSTRAP_SYSADMINS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const authOptions: NextAuthOptions = {
    debug: true,
    adapter: patchedAdapter,
    providers: [
        GoogleProvider({
            clientId: config.googleClientId(),
            clientSecret: config.googleClientSecret(),
            allowDangerousEmailAccountLinking: true,
            authorization: {
                params: {
                    prompt: "select_account",
                    access_type: "offline",
                    response_type: "code"
                }
            },
            profile(profile) {
                return {
                    id: profile.sub,
                    name: profile.name,
                    email: profile.email,
                    image: profile.picture,
                    googleId: profile.sub
                }
            }
        }),
        // Persona-mint — the unified impersonation flow for dev + local (DEV_INSTANCE_DESIGN.md §5).
        // Dead in prod by construction. Mints a real session AS the chosen persona, stamping an
        // inert `impersonatedBy` claim (display/audit only — no authz path reads it). The policy
        // lives in evaluateMint(); this provider just supplies the caller's claims and the target.
        // (Replaces the old local-only "Offline Login" provider — local mints are the
        // unauthenticated-caller case in evaluateMint.)
        ...(config.isDevInstance() ? [
            CredentialsProvider({
                id: PERSONA_MINT_PROVIDER_ID,
                name: "Persona",
                credentials: {
                    personaId: { label: "Persona ID", type: "text" },
                    mode: { label: "Mode", type: "text" },
                },
                async authorize(credentials, req) {
                    const mode: MintMode = credentials?.mode === "return" ? "return" : "impersonate";

                    // The caller's *current* session — the security boundary. getToken decrypts the
                    // session cookie carried on this request; null when not signed in.
                    // The `req` NextAuth hands to a credentials authorize() has NO `cookies` field
                    // (only query/body/headers/method), and getToken reads req.cookies exclusively —
                    // it never parses the cookie header. Without the next/headers cookie store the
                    // caller always looks anonymous and every dev-instance mint is denied.
                    const callerToken = await getToken({
                        req: {
                            headers: req.headers,
                            cookies: await requestCookies(),
                        } as unknown as Parameters<typeof getToken>[0]["req"],
                        secret: config.nextAuthSecret(),
                    });

                    const decision = evaluateMint({
                        checkinEnv: config.checkinEnv(),
                        mode,
                        caller: callerToken
                            ? {
                                  email: callerToken.email,
                                  hd: callerToken.hd ?? null,
                                  emailVerified: callerToken.emailVerified ?? false,
                                  impersonatedBy: callerToken.impersonatedBy ?? null,
                              }
                            : null,
                    });
                    if (!decision.allowed) return null;

                    // Resolve the target participant (fake data only — must already exist).
                    let dbParticipant;
                    if (mode === "return") {
                        dbParticipant = await prisma.participant.findUnique({
                            where: { email: decision.targetEmail! },
                        });
                    } else {
                        const personaId = parseInt(String(credentials?.personaId ?? ""), 10);
                        if (isNaN(personaId)) return null;
                        dbParticipant = await prisma.participant.findUnique({
                            where: { id: personaId },
                        });
                    }
                    if (!dbParticipant) return null;

                    // Record the mint in the dev ledger (DEV_DASHBOARD_DESIGN.md §6), attributed to
                    // the REAL human. impersonatedBy set → an impersonation (real human becomes a
                    // persona); null → a plain login (e.g. a local first-login as the persona).
                    const realActor = decision.impersonatedBy ?? dbParticipant.email ?? "unknown";
                    await recordLedger(
                        decision.impersonatedBy ? "impersonate" : "login",
                        realActor,
                        decision.impersonatedBy ? (dbParticipant.email ?? dbParticipant.name) : null,
                    );

                    return {
                        id: dbParticipant.id.toString(),
                        email: dbParticipant.email,
                        name: dbParticipant.name,
                        impersonatedBy: decision.impersonatedBy,
                    };
                }
            })
        ] : [])
    ],
    secret: config.nextAuthSecret(),
    // Use our styled sign-in screen instead of NextAuth's bare default page.
    pages: {
        signIn: "/signin",
    },
    session: {
        strategy: "jwt",
        // Bound token lifetime so a stale or forgotten session cannot live for the
        // 30-day NextAuth default. The jwt callback below also re-syncs role flags
        // from the DB on every request so revocations take effect promptly.
        maxAge: 60 * 60 * 8,   // 8 hours
        updateAge: 60 * 15,    // 15 minutes
    },
    callbacks: {
        async jwt({ token, user, account, profile }) {
            // Capture Google's hosted-domain + email_verified claims on sign-in so the dev-instance
            // middleware can gate on verified org membership (see DEV_INSTANCE_DESIGN.md §4).
            // Prefer the `hd` claim over string-matching the email suffix.
            if (account?.provider === "google" && profile) {
                const googleProfile = profile as { hd?: string; email_verified?: boolean };
                token.hd = googleProfile.hd ?? null;
                token.emailVerified = googleProfile.email_verified ?? false;
            }
            // Persona-mint: stamp the inert provenance claim (null clears it on "return to me").
            // On the cloud dev instance, carry the org gate claims onto the minted session so the
            // middleware still passes — every dev mint is by/returns to a verified org member
            // (enforced in evaluateMint), and the middleware must never read impersonatedBy.
            if (account?.provider === PERSONA_MINT_PROVIDER_ID && user) {
                token.impersonatedBy = (user as { impersonatedBy?: string | null }).impersonatedBy ?? null;
                if (config.checkinEnv() === "dev") {
                    token.hd = ORG_DOMAIN;
                    token.emailVerified = true;
                }
            }
            if (user) {
                const dbParticipant = await prisma.participant.findUnique({
                    where: { email: user.email! },
                    include: {
                        toolStatuses: {
                            select: {
                                toolId: true,
                                level: true
                            }
                        }
                    }
                });

                if (dbParticipant) {
                    if (
                        !dbParticipant.sysadmin &&
                        dbParticipant.email &&
                        BOOTSTRAP_SYSADMINS.includes(dbParticipant.email.toLowerCase())
                    ) {
                        await prisma.participant.update({
                            where: { id: dbParticipant.id },
                            data: { sysadmin: true },
                        });
                        dbParticipant.sysadmin = true;
                    }

                    token.id = dbParticipant.id;
                    token.sysadmin = dbParticipant.sysadmin;
                    token.keyholder = dbParticipant.keyholder;
                    token.boardMember = dbParticipant.boardMember;
                    token.shopSteward = dbParticipant.shopSteward;
                    token.backgroundCheckReviewer = dbParticipant.backgroundCheckReviewer;
                    token.householdId = dbParticipant.householdId;
                    token.toolStatuses = dbParticipant.toolStatuses;
                }
            } else if (token.id) {
                // On every subsequent request (no `user` present), re-sync authority
                // flags from the DB so role grants/revocations take effect without
                // waiting for the token to expire. Previously these flags were only
                // read at sign-in, which let a revoked sysadmin/keyholder keep their
                // privileges (including the /api/admin/roles endpoint) until the JWT
                // aged out — up to 30 days.
                const dbParticipant = await prisma.participant.findUnique({
                    where: { id: token.id as number },
                    include: {
                        toolStatuses: {
                            select: {
                                toolId: true,
                                level: true
                            }
                        }
                    }
                });

                if (!dbParticipant) {
                    // Account no longer exists — return an empty token so every
                    // downstream authorization check fails closed. The cast is
                    // deliberate: JWT requires `id`, and omitting it is the point.
                    return {} as JWT;
                }

                token.sysadmin = dbParticipant.sysadmin;
                token.keyholder = dbParticipant.keyholder;
                token.boardMember = dbParticipant.boardMember;
                token.shopSteward = dbParticipant.shopSteward;
                token.backgroundCheckReviewer = dbParticipant.backgroundCheckReviewer;
                token.householdId = dbParticipant.householdId;
                token.toolStatuses = dbParticipant.toolStatuses;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.id;
                session.user.sysadmin = token.sysadmin;
                session.user.keyholder = token.keyholder;
                session.user.boardMember = token.boardMember;
                session.user.shopSteward = token.shopSteward;
                session.user.backgroundCheckReviewer = token.backgroundCheckReviewer;
                session.user.householdId = token.householdId;
                session.user.toolStatuses = token.toolStatuses || [];
                session.user.impersonatedBy = token.impersonatedBy ?? null;
                // Surface the org-gate claims so dev-only server actions (assertDevActor) can
                // re-verify the caller is a verified org member without re-decoding the JWT.
                session.user.hd = token.hd ?? null;
                session.user.emailVerified = token.emailVerified ?? false;
            }
            return session;
        }
    }
}
