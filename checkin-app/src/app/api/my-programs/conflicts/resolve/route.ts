import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { intervalsOverlap } from "@/lib/attendanceConflicts";

/**
 * Resolve an attendance conflict by deleting one of the duplicate Visit rows.
 * Real write, audited like every other Visit change (action DELETE, tableName
 * 'Visit', actorId, oldData snapshot) — see attendance/route.ts.
 *
 * Authorization is re-checked server-side (never trust the client): the caller
 * must lead the program that owns the event for the visit being deleted, or be a
 * global admin (sysadmin/boardMember/keyholder) — mirroring the attendance route.
 * And the visit must actually be part of an overlap, so we can't be tricked into
 * deleting a participant's legitimate sole visit.
 *
 * ponytail: a plain lead can only delete a visit ANCHORED to their own event
 * (associatedEventId). In the kiosk-race case that's exactly the synthetic row to
 * drop (keep the real badge-in); the unassociated kiosk row is not directly
 * deletable here. Widen with an overlap-based scope check if leads need to delete
 * the kiosk side too.
 */
export const POST = withAuth({}, async (req, auth) => {
  if (auth.type !== "session") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = auth.user;

  const body = await req.json().catch(() => null);
  const visitId = body?.visitId;
  if (!Number.isInteger(visitId)) {
    return NextResponse.json({ error: "visitId (integer) is required" }, { status: 400 });
  }

  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: { event: { include: { program: { select: { leadMentorId: true } } } } },
  });
  if (!visit) {
    return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  }

  const isGlobalAdmin = !!(user.sysadmin || user.boardMember || user.keyholder);
  const leadsOwningProgram = visit.event?.program?.leadMentorId === user.id;
  if (!isGlobalAdmin && !leadsOwningProgram) {
    return NextResponse.json({ error: "Forbidden: not authorized to resolve this visit" }, { status: 403 });
  }

  // Guard: only delete a visit that genuinely overlaps another of the same
  // participant's visits. Refuse to delete an isolated, legitimate visit.
  const siblings = await prisma.visit.findMany({
    where: { participantId: visit.participantId, id: { not: visit.id } },
    select: { arrivedAt: true, departedAt: true },
  });
  const isConflicting = siblings.some((s) => intervalsOverlap(visit, s));
  if (!isConflicting) {
    return NextResponse.json({ error: "Visit is not part of an attendance conflict" }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.visit.delete({ where: { id: visit.id } });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "DELETE",
        tableName: "Visit",
        affectedEntityId: visit.id,
        secondaryAffectedEntity: visit.associatedEventId,
        oldData: JSON.stringify({
          participantId: visit.participantId,
          arrivedAt: visit.arrivedAt,
          departedAt: visit.departedAt,
          arrivedVia: visit.arrivedVia,
          departedVia: visit.departedVia,
          associatedEventId: visit.associatedEventId,
          reason: "duplicate-attendance-conflict",
        }),
      },
    });
  });

  return NextResponse.json({ success: true, deletedVisitId: visit.id });
});
