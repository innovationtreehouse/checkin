import prisma from "@/lib/prisma";
import { normalizeAuditData } from "@/lib/auditPayload";

/**
 * Fetch the latest AuditLog row matching {action, tableName, affectedEntityId}
 * (optionally scoped by secondaryAffectedEntity) and fail loudly if none exists.
 * Lets a test assert the actor + before/after snapshot a route claims to write,
 * so a regression that drops the actor, mislabels the action, or skips the log
 * turns the test red instead of passing green.
 *
 * oldData/newData are Json columns: some writers store an object, others a
 * JSON.stringify'd string. Use auditJson() to read either shape uniformly.
 */
export async function expectAuditRow(
    db: typeof prisma,
    q: { action: string; tableName: string; affectedEntityId: number; secondaryAffectedEntity?: number },
) {
    const row = await db.auditLog.findFirst({
        where: {
            action: q.action as never,
            tableName: q.tableName,
            affectedEntityId: q.affectedEntityId,
            ...(q.secondaryAffectedEntity !== undefined && { secondaryAffectedEntity: q.secondaryAffectedEntity }),
        },
        // timestamp can tie at ms resolution within a fast test; id breaks the tie
        // so we always return the genuinely newest row.
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    });
    if (!row) {
        const sec = q.secondaryAffectedEntity !== undefined ? ` secondary=${q.secondaryAffectedEntity}` : "";
        throw new Error(`Expected AuditLog ${q.action} ${q.tableName}#${q.affectedEntityId}${sec}, found none`);
    }
    return row;
}

/** Read a Json audit column whether it was stored as an object or a JSON string. */
export function auditJson(v: unknown): Record<string, unknown> {
    return (normalizeAuditData(v) ?? {}) as Record<string, unknown>;
}
