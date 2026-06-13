import prisma from '@/lib/prisma';
import type { Role } from '@/security/core';
import type { SessionUser } from '@/types/participant';

export interface Persona {
    role: Role;
    sessionUser?: SessionUser;
    description: string;
}

let cached: Record<string, Persona> | null = null;

async function ensure(
    emailSuffix: string,
    mutate: Partial<{
        name: string;
        sysadmin: boolean;
        boardMember: boolean;
        keyholder: boolean;
        backgroundCheckReviewer: boolean;
    }>,
) {
    const email = `policy-persona-${emailSuffix}@example.test`;
    let p = await prisma.participant.findUnique({ where: { email } });
    if (!p) {
        p = await prisma.participant.create({
            data: {
                email,
                name: mutate.name ?? emailSuffix,
                ...mutate,
                household: { create: { name: `${mutate.name ?? emailSuffix} Household` } },
            },
        });
    } else {
        p = await prisma.participant.update({ where: { id: p.id }, data: mutate });
    }
    return p;
}

export async function loadPersonas(): Promise<Record<string, Persona>> {
    if (cached) return cached;

    const rankAndFile = await ensure('rank-and-file', { name: 'Rank File' });
    const sysadmin = await ensure('sysadmin', { name: 'Sys Admin', sysadmin: true });
    const boardMember = await ensure('board-member', { name: 'Board Member', boardMember: true });
    const keyholder = await ensure('keyholder', { name: 'Key Holder', keyholder: true });
    const bgReviewer = await ensure('bg-reviewer', { name: 'BG Reviewer', backgroundCheckReviewer: true });

    const mkUser = (p: {
        id: number;
        email: string | null;
        name: string | null;
        sysadmin: boolean;
        boardMember: boolean;
        keyholder: boolean;
        backgroundCheckReviewer: boolean;
    }): SessionUser => ({
        id: p.id,
        email: p.email ?? '',
        name: p.name ?? undefined,
        sysadmin: p.sysadmin,
        boardMember: p.boardMember,
        keyholder: p.keyholder,
        backgroundCheckReviewer: p.backgroundCheckReviewer,
    });

    cached = {
        anyone: {
            role: 'anyone',
            sessionUser: mkUser(rankAndFile),
            description: 'Catch-all — use any logged-in user',
        },
        unauthenticated: { role: 'unauthenticated', description: 'No session, no kiosk' },
        authenticated: {
            role: 'authenticated',
            sessionUser: mkUser(rankAndFile),
            description: 'Logged-in non-privileged user',
        },
        sysadmin: { role: 'sysadmin', sessionUser: mkUser(sysadmin), description: 'sysadmin=true' },
        boardMember: {
            role: 'boardMember',
            sessionUser: mkUser(boardMember),
            description: 'boardMember=true',
        },
        keyholder: {
            role: 'keyholder',
            sessionUser: mkUser(keyholder),
            description: 'keyholder=true',
        },
        backgroundCheckReviewer: {
            role: 'backgroundCheckReviewer',
            sessionUser: mkUser(bgReviewer),
            description: 'backgroundCheckReviewer=true',
        },
        kiosk: { role: 'kiosk', description: 'Kiosk signature (no user)' },
        // programLeadMentor, programCoreVolunteer, householdLead are data-scoped roles
        // exercised through their parent route's specific tests, not the generic contract.
    };
    return cached;
}
