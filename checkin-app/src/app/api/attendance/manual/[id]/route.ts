import { withAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { parseVisitTime, departureAfterArrival, withinMaxDuration } from "@/lib/visitTimes";
import { processVisitCheckout } from "@/lib/attendanceTransitions";
import { editSignificance, deleteSignificance } from "@/lib/visit/significance";
import { emailBoardMembers } from "@/lib/emailRecipients";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";
import { formatDateTime } from "@/lib/time";

// Self-correction of the member's OWN visits (trust-first, see
// docs/designs/1256_ATTENDANCE_CORRECTION_SURFACE.md §2): the edit always
// applies — the only gates are validity (times parse, departure after arrival,
// ≤ 24h, no reopening) and ownership. Integrity is post-hoc: every change is
// audited, and a significant one (big delta × trusted old source, or any
// delete) is flagged to the board. Recurring-audit note: arbitrary backdate is
// accepted on purpose here exactly as on the sibling POST — self-reported
// hours are not a security boundary.

async function loadOwnVisit(id: number, userId: number) {
    const visit = await prisma.visit.findUnique({ where: { id } });
    // Not-yours and tombstoned both read as 404 — no existence oracle on other
    // people's visit ids.
    if (!visit || visit.deletedAt || visit.personId !== userId) return null;
    return visit;
}

function flagBoard(kind: "edit" | "delete", visitId: number, actorName: string, score: number, detail: string) {
    // Fire-and-forget (errors logged and swallowed inside the helper): the
    // flag is oversight, never a gate on the member's response.
    void emailBoardMembers(
        `Attendance: significant self-${kind} of visit #${visitId}`,
        `<p>${actorName} ${kind === "delete" ? "deleted" : "changed"} one of their own visits ` +
        `(significance ${score}).</p><p>${detail}</p>` +
        `<p>Full before/after is in the audit trail (Visit #${visitId}).</p>`,
        "Self-correction board flag failed:",
    );
}

export const PATCH = withAuth({}, async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    try {
        const userId = auth.user.id;
        const visitId = Number((await ctx.params).id);
        if (!Number.isInteger(visitId)) return apiError("Invalid visit id", 400);

        const body = await req.json();
        const { arrivedAt, departedAt } = body;
        if (!arrivedAt && !departedAt) return apiError("Nothing to change.", 400);

        const visit = await loadOwnVisit(visitId, userId);
        if (!visit) return apiError("Visit not found.", 404);

        const now = new Date();
        let nextArrived = visit.arrivedAt;
        let nextDeparted = visit.departedAt;

        if (arrivedAt) {
            const r = parseVisitTime(arrivedAt, "arrival", now);
            if (!r.ok) return apiError(r.error, 400);
            nextArrived = r.value;
        }
        if (departedAt) {
            const r = parseVisitTime(departedAt, "departure", now);
            if (!r.ok) return apiError(r.error, 400);
            nextDeparted = r.value;
        }

        // A closed visit stays closed (same rule as the staff route): editing
        // must never turn a historical record back into "in the building".
        if (visit.departedAt && !nextDeparted) {
            return apiError("Departure time is required to close this visit.", 400);
        }
        if (nextDeparted && !departureAfterArrival(nextArrived, nextDeparted)) {
            return apiError("Departure time must be after arrival time", 400);
        }
        if (nextDeparted && !withinMaxDuration(nextArrived, nextDeparted)) {
            return apiError("A visit cannot be longer than 24 hours.", 400);
        }

        const significance = editSignificance(visit, { arrivedAt: nextArrived, departedAt: nextDeparted });

        const closingOpenVisit = !visit.departedAt && !!nextDeparted;

        // Same per-person advisory lock as every other visit write: an edit
        // must not race the kiosk, the sweep, or a concurrent submit. When the
        // edit CLOSES an open visit, only the arrival is written here — the
        // departure goes through processVisitCheckout below (it refuses
        // already-closed visits, and it owns the back-to-back event chunking).
        const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${Number(userId)})`;
            // An edited value is a self-report now, whatever captured it before.
            return tx.visit.update({
                where: { id: visitId },
                data: {
                    ...(arrivedAt ? { arrivedAt: nextArrived, arrivedVia: "WEB" } : {}),
                    ...(departedAt && !closingOpenVisit ? { departedAt: nextDeparted, departedVia: "WEB" } : {}),
                },
            });
        });

        if (closingOpenVisit) {
            await processVisitCheckout(visitId, nextDeparted!, undefined, "WEB");
        }

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "EDIT",
                tableName: "Visit",
                affectedEntityId: visitId,
                secondaryAffectedEntity: visit.personId,
                oldData: { arrivedAt: visit.arrivedAt, departedAt: visit.departedAt, arrivedVia: visit.arrivedVia, departedVia: visit.departedVia },
                newData: { arrivedAt: nextArrived, departedAt: nextDeparted, type: "self_correction", significance },
            }
        });

        if (significance.flagged) {
            flagBoard("edit", visitId, auth.user.name ?? `person #${userId}`, significance.score,
                `${formatDateTime(visit.arrivedAt)} → ${formatDateTime(nextArrived)}`);
        }

        return NextResponse.json({ visit: updated, flagged: significance.flagged });
    } catch (error: unknown) {
        await logBackendError(error, "PATCH /api/attendance/manual/[id]");
        return apiError("Internal Server Error", 500);
    }
});

export const DELETE = withAuth({}, async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    try {
        const userId = auth.user.id;
        const visitId = Number((await ctx.params).id);
        if (!Number.isInteger(visitId)) return apiError("Invalid visit id", 400);

        const visit = await loadOwnVisit(visitId, userId);
        if (!visit) return apiError("Visit not found.", 404);

        const significance = deleteSignificance(visit);

        // Tombstone, never a row removal: the deletion is reviewable in AT12
        // and reversible by clearing deletedAt. Same advisory lock as above.
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${Number(userId)})`;
            await tx.visit.update({
                where: { id: visitId },
                data: { deletedAt: new Date(), deletedById: userId },
            });
        });

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "DELETE",
                tableName: "Visit",
                affectedEntityId: visitId,
                secondaryAffectedEntity: visit.personId,
                oldData: { arrivedAt: visit.arrivedAt, departedAt: visit.departedAt, arrivedVia: visit.arrivedVia, departedVia: visit.departedVia },
                newData: { type: "self_correction", significance },
            }
        });

        // Every delete flags — the floor (§2).
        flagBoard("delete", visitId, auth.user.name ?? `person #${userId}`, significance.score,
            `Visit ${formatDateTime(visit.arrivedAt)} – ${visit.departedAt ? formatDateTime(visit.departedAt) : "(open)"} tombstoned.`);

        return NextResponse.json({ success: true, flagged: true });
    } catch (error: unknown) {
        await logBackendError(error, "DELETE /api/attendance/manual/[id]");
        return apiError("Internal Server Error", 500);
    }
});
