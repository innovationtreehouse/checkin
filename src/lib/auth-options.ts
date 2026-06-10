import { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config";

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
        // Offline credential login — local laptops only (CHECKIN_ENV=local). Lets a developer
        // sign in without Google. This is NOT enabled on the cloud dev instance (CHECKIN_ENV=dev),
        // which is publicly reachable and must use real Google org login; impersonation there is
        // handled by the separate gated mint flow (see DEV_INSTANCE_DESIGN.md §5).
        ...(config.isLocal() ? [
            CredentialsProvider({
                name: "Local Offline Login",
                credentials: {
                    email: { label: "Enter any email to log in locally", type: "email", placeholder: "test@example.com" }
                },
                async authorize(credentials) {
                    if (!credentials?.email) return null; console.log("Dev Login Email:", credentials.email);

                    let dbParticipant = await prisma.participant.findUnique({
                        where: { email: credentials.email }
                    });

                    if (!dbParticipant) {
                        dbParticipant = await createParticipantWithHousehold({
                            email: credentials.email,
                            name: "Mock User - " + credentials.email.split('@')[0],
                        });
                    }

                    return {
                        id: dbParticipant.id.toString(),
                        email: dbParticipant.email,
                        name: dbParticipant.name,
                    };
                }
            })
        ] : [])
    ],
    secret: config.nextAuthSecret(),
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
            }
            return session;
        }
    }
}
