import type { Person, PresenceDirection } from "@/generated/prisma/client";
import { apiJson } from "@/lib/api-response";
import type { DbClient } from "@/lib/db-client";
import { LIVE_PERSON } from "@/lib/person/filters";
import { LIVE_VISIT } from "@/lib/visit/filters";
import { processCheckin, processCheckout } from "@/lib/scan-service";
import {
    PresenceClass,
    appendPresenceEvent,
    classifyPresenceEvent,
} from "@/lib/presence/events";

/**
 * Apply a displayed IN/OUT intent (invariant 5). Direction is an input; this
 * never re-toggles from live Visit state. Conflicts park and do not mutate.
 *
 * Projection C: a non-keyholder IN while the facility is closed is held
 * (PARKED_CLOSED, no human queue) until a keyholder Visit exists, then
 * {@link flushParkedClosed} projects in occurredAt order.
 */
export async function applyPresenceIntent(
    db: DbClient,
    args: {
        participant: Person;
        direction: PresenceDirection;
        occurredAt: Date;
        authType: string;
        source: "SCANNER" | "TYPED";
        clientEventId?: string | null;
        clockSuspect?: boolean;
        confirmToken?: string | null;
        replayEventId?: string | null;
        /** Manual open follows C too: hold instead of 403 when closed. */
        holdWhenClosed?: boolean;
    },
): Promise<Response> {
    const event = await appendPresenceEvent(db, {
        personId: args.participant.id,
        occurredAt: args.occurredAt,
        direction: args.direction,
        source: args.source,
        clientEventId: args.clientEventId,
        clockSuspect: args.clockSuspect,
        classification: args.clockSuspect ? PresenceClass.PARKED_CLOCK : null,
    });

    if (args.clockSuspect) {
        return apiJson({ type: "parked", message: "Recorded for review." });
    }

    const openVisit = await db.visit.findFirst({
        where: { personId: args.participant.id, departedAt: null, ...LIVE_VISIT },
        orderBy: { arrivedAt: "desc" },
        select: { id: true },
    });

    if (args.direction === "IN") {
        if (openVisit) {
            await classifyPresenceEvent(db, event.id, PresenceClass.CONFLICT_DOUBLE_IN);
            return apiJson({ type: "parked", message: "Recorded for review." });
        }

        const holdClosed = args.authType === "kiosk" || args.holdWhenClosed === true;
        if (!args.participant.isKeyholder && holdClosed) {
            const activeKeyholders = await db.visit.count({
                where: { departedAt: null, person: { isKeyholder: true, ...LIVE_PERSON }, ...LIVE_VISIT },
            });
            if (activeKeyholders === 0) {
                await classifyPresenceEvent(db, event.id, PresenceClass.PARKED_CLOSED);
                return apiJson({ type: "parked", message: "Recorded. Will project when a keyholder is present." });
            }
        }

        const res = await processCheckin(args.participant, args.authType, db, args.occurredAt);
        const projected = await visitIdFromCheckin(res);
        await classifyPresenceEvent(
            db,
            event.id,
            projected != null ? PresenceClass.PROJECTED : PresenceClass.PARKED_CLOSED,
            projected,
        );
        if (projected != null && args.participant.isKeyholder) {
            await flushParkedClosed(db);
        }
        return res;
    }

    if (!openVisit) {
        await classifyPresenceEvent(db, event.id, PresenceClass.CONFLICT_OUT_NO_IN);
        return apiJson({ type: "parked", message: "Recorded for review." });
    }

    const res = await processCheckout(
        args.participant,
        openVisit.id,
        args.authType,
        db,
        args.confirmToken ?? null,
        args.occurredAt,
        args.replayEventId ?? null,
    );
    await classifyPresenceEvent(db, event.id, PresenceClass.PROJECTED, openVisit.id);
    return res;
}

/** After a keyholder Visit exists, project every PARKED_CLOSED event in
 *  happened-at order. No human on the happy path (projection C). */
export async function flushParkedClosed(db: DbClient): Promise<void> {
    const held = await db.presenceEvent.findMany({
        where: { classification: PresenceClass.PARKED_CLOSED },
        orderBy: { occurredAt: "asc" },
        include: { person: true },
    });
    for (const ev of held) {
        // A merge racing the flush leaves a tombstone here (the repoint runs at
        // merge time; this is the in-flight window). One hop reaches the keeper —
        // the archive design guarantees chains never exceed it.
        const person = ev.person.mergedIntoId
            ? ((await db.person.findUnique({ where: { id: ev.person.mergedIntoId } })) ?? ev.person)
            : ev.person;
        const openVisit = await db.visit.findFirst({
            where: { personId: person.id, departedAt: null, ...LIVE_VISIT },
            select: { id: true },
        });
        if (ev.direction === "IN") {
            if (openVisit) {
                await classifyPresenceEvent(db, ev.id, PresenceClass.CONFLICT_DOUBLE_IN);
                continue;
            }
            const res = await processCheckin(person, "kiosk", db, ev.occurredAt);
            const projected = await visitIdFromCheckin(res);
            await classifyPresenceEvent(
                db,
                ev.id,
                projected != null ? PresenceClass.PROJECTED : PresenceClass.PARKED_CLOSED,
                projected,
            );
        } else if (openVisit) {
            await processCheckout(person, openVisit.id, "kiosk", db, null, ev.occurredAt, ev.clientEventId);
            await classifyPresenceEvent(db, ev.id, PresenceClass.PROJECTED, openVisit.id);
        } else {
            await classifyPresenceEvent(db, ev.id, PresenceClass.CONFLICT_OUT_NO_IN);
        }
    }
}

async function visitIdFromCheckin(res: Response): Promise<number | null> {
    if (!res.ok) return null;
    try {
        const body = (await res.clone().json()) as { type?: string; visit?: { id?: number } };
        if (body.type === "checkin" && typeof body.visit?.id === "number") return body.visit.id;
    } catch {
        return null;
    }
    return null;
}
