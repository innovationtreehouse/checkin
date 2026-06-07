import { NextAuthOptions } from "next-auth";
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
        ...(process.env.NEXT_PUBLIC_DEV_AUTH && process.env.NODE_ENV !== 'production' ? [
            CredentialsProvider({
                name: "Development Mock Auth",
                credentials: {
                    email: { label: "Enter any email to mock login", type: "email", placeholder: "test@example.com" }
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
    },
    callbacks: {
        async jwt({ token, user, account }) {
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
                session.user.householdId = token.householdId;
                session.user.toolStatuses = token.toolStatuses || [];
            }
            return session;
        }
    }
}
