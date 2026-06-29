import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { ORG_DOMAIN } from "@/lib/config";

export const dynamic = 'force-dynamic';

// Count of "member families": households with at least one participant whose email is NOT an
// org (@innovationtreehouse.org) address. Treehouse staff households are size 1 holding only the
// staff lead's org email — non-staff cannot be added to them (enforced on the member-add path) —
// so they have zero non-org participants and fall out of the count. Households with a null-email
// member (e.g. a child without an account) count: they are real families, not staff.
export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async () => {
        try {
            const count = await prisma.household.count({
                where: {
                    participants: {
                        // A null email is not an org address, but Prisma's `NOT endsWith` skips
                        // null rows — list it explicitly so null-email members (e.g. children) count.
                        some: {
                            OR: [
                                { email: null },
                                { NOT: { email: { endsWith: `@${ORG_DOMAIN}` } } },
                            ],
                        },
                    },
                },
            });
            return NextResponse.json({ count });
        } catch (error) {
            console.error("Failed to count member families:", error);
            return NextResponse.json({ error: "Failed to count member families" }, { status: 500 });
        }
    }
);
