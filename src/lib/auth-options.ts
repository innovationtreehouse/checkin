import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getToken } from "next-auth/jwt";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import { config, ORG_DOMAIN } from "@/lib/config";
import { evaluateMint, type MintMode } from "@/lib/impersonation";

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
                    const callerToken = await getToken({
                        req: req as Parameters<typeof getToken>[0]["req"],
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
    session: {
        strategy: "jwt",
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
            }
            return session;
        }
    }
}
