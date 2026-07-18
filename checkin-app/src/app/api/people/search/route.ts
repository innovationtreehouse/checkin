import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { personRecordIsActiveOrgMember } from "@/lib/orgMembership";
import { apiError } from "@/lib/api-response";
import { rolesToFlags } from "@/lib/roles";
import { LIVE_PERSON } from "@/lib/person/filters";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember', 'isOperations'] },
    async (req, auth) => {
        try {
            const url = new URL(req.url);
            const q = url.searchParams.get('q') || '';

            const eighteenYearsAgo = new Date();
            eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

            const people = await prisma.person.findMany({
                where: {
                    ...LIVE_PERSON,
                    ...(q ? {
                        OR: [
                            { name: { contains: q, mode: 'insensitive' } },
                            { email: { contains: q, mode: 'insensitive' } },
                        ]
                    } : {}),
                },
                take: 200,
                orderBy: { id: 'desc' },
                include: {
                    household: {
                        include: {
                            householdMembers: true,
                            orgMembership: true,
                        }
                    },
                    // isOperations has no column — every flag derives through this one
                    // relation so there's a single code path (rolesToFlags), not four
                    // mirror reads plus one table read.
                    roles: { select: { role: true } },
                }
            });

            // Operations holds the Participants directory (contacts) view only — no
            // background-check compliance dates, no membership/finance standing
            // (Household.orgMembership). Board/sysadmin keep the full shape.
            // See membership-ops/layout.tsx's Participants-only nav gate for ops.
            const opsOnly = auth.type === 'session' && auth.user.isOperations
                && !auth.user.isSysadmin && !auth.user.isBoardMember;

            const formatted = people.map(p => ({
                id: p.id,
                name: p.name,
                email: p.email,
                phone: p.phone,
                dateOfBirth: p.dateOfBirth,
                isDeclaredAdult: p.isDeclaredAdult,
                // `undefined` drops the key on JSON serialization — a stripped
                // response, not a null/zeroed one.
                lastBackgroundCheck: opsOnly ? undefined : p.lastBackgroundCheck,
                isMember: personRecordIsActiveOrgMember(p),
                ...rolesToFlags(p.roles),
                household: p.household ? { ...p.household, orgMembership: opsOnly ? undefined : p.household.orgMembership } : null,
            }));

            return NextResponse.json({ people: formatted });
        } catch (error) {
            logger.error("Failed to fetch people:", error);
            return apiError("Failed to fetch people", 500);
        }
    }
);
