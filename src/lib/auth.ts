/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

/**
 * Returns the currently authenticated NextAuth session user.
 */
export async function getCurrentUser() {
    const session = await getServerSession(authOptions);
    return session?.user || null;
}

export function requireAdmin(user: any) {
    if (!user || (!user.sysadmin && !user.boardMember)) {
        throw new Error("Unauthorized: Requires Admin Role");
    }
}

export function requireKeyholder(user: any) {
    if (!user || !user.keyholder) {
        throw new Error("Unauthorized: Requires Keyholder Role");
    }
}
