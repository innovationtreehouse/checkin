import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Board-only read-only list of every background-check attestation — "who signed
 * off what". Returns attestations newest-first with the reviewer's name, the
 * subject's name (when named), the household, the result, and the process kind.
 */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async () => {
    const rows = await prisma.backgroundCheckAttestation.findMany({
        select: {
            id: true,
            result: true,
            note: true,
            isMarkedVolunteer: true,
            createdAt: true,
            reviewer: { select: { id: true, name: true } },
            subjectPerson: { select: { id: true, name: true } },
            process: {
                select: {
                    id: true,
                    kind: true,
                    status: true,
                    bgClearedAt: true,
                    subjectPerson: { select: { id: true, name: true, householdId: true, household: { select: { name: true } } } },
                    orgMembership: { select: { household: { select: { id: true, name: true } } } },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    const attestations = rows.map((r) => {
        const isPersonBg = r.process.kind === "PERSON_BG";
        const household = isPersonBg
            ? r.process.subjectPerson?.household ?? null
            : r.process.orgMembership?.household ?? null;
        const subject = isPersonBg
            ? r.process.subjectPerson
            : r.subjectPerson;
        return {
            id: r.id,
            result: r.result,
            note: r.note,
            isMarkedVolunteer: r.isMarkedVolunteer,
            createdAt: r.createdAt.toISOString(),
            reviewerName: r.reviewer.name || `Person #${r.reviewer.id}`,
            subjectName: subject?.name || (subject ? `Person #${subject.id}` : null),
            householdId: household?.id ?? null,
            householdName: household?.name || (household ? `Household #${household.id}` : null),
            processId: r.process.id,
            processKind: r.process.kind,
            processStatus: r.process.status,
            cleared: !!r.process.bgClearedAt,
        };
    });

    return NextResponse.json({ attestations });
});
