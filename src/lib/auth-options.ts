/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";

// NextAuth PrismaAdapter hardcodes `prisma.user` for its user operations.
// We map `.user` to `.participant` so the adapter can find our custom model.
const prismaAdapterCore = prisma as any;
const prismaAdapterClient = {
    ...prismaAdapterCore,
    user: prismaAdapterCore.participant,
};

// Wrap the adapter so `getUser` can handle string IDs from CredentialsProvider.
// NextAuth always coerces IDs to strings, but our Participant.id is an Int.
const baseAdapter = PrismaAdapter(prismaAdapterClient) as any;
const patchedAdapter = {
    ...baseAdapter,
    getUser: async (id: string) => {
        const numericId = parseInt(id, 10);
        if (isNaN(numericId)) return null;
        const user = await prisma.participant.findUnique({ where: { id: numericId } });
        return user ? { ...user, id: String(user.id) } : null;
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
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
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
        ...(process.env.NEXT_PUBLIC_DEV_AUTH ? [
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
                        dbParticipant = await prisma.participant.create({
                            data: {
                                email: credentials.email,
                                name: "Mock User - " + credentials.email.split('@')[0],
                            }
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
    secret: process.env.NEXTAUTH_SECRET,
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
                (session.user as any).id = token.id;
                (session.user as any).sysadmin = token.sysadmin;
                (session.user as any).keyholder = token.keyholder;
                (session.user as any).boardMember = token.boardMember;
                (session.user as any).shopSteward = token.shopSteward;
                (session.user as any).householdId = token.householdId;
                (session.user as any).toolStatuses = token.toolStatuses || [];
            }
            return session;
        }
    }
}
