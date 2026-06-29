import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateRequest } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { processCheckin, processCheckout, finalizeFacilityClose } from "@/lib/scan-service";
import { logBackendError } from "@/lib/logger";
import { config } from "@/lib/config";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
    const startTime = Date.now();

    // High cap: kiosks burst and a whole facility may share one NAT IP.
    const limited = rateLimit(req, { name: "scan", limit: 300, windowMs: 60_000 });
    if (limited) return limited;

    try {
        const rawBody = await req.text();

        // 1. Authenticate
        const auth = await authenticateRequest(req, rawBody);

        let body;
        try {
            body = JSON.parse(rawBody);
        } catch {
            return apiError("Invalid JSON payload.", 400);
        }

        const participantId = body.participantId;

        if (!participantId || typeof participantId !== 'number') {
            return apiError("A valid numeric participantId is required.", 400);
        }

        // 2. Authorization
        if (auth.type === 'unauthenticated') {
            return apiError("Unauthorized: Missing kiosk signature or invalid session", 401);
        }

        // Web session: check if user can scan this participant
        let pendingHouseholdCheck = false;
        if (auth.type === 'session') {
            const user = auth.user;
            const isSelf = participantId === Number(user.id);
            const isAdmin = user.sysadmin || user.keyholder || user.boardMember;

            // In production, only privileged users may self-check-in via web.
            // Everyone else must use the kiosk badge scanner.
            if (isSelf && !isAdmin && config.isProd()) {
                return apiError("Please use the kiosk badge scanner to check in.", 403);
            }

            if (!isSelf && !isAdmin) {
                if (user.householdId && user.householdLead) {
                    pendingHouseholdCheck = true;
                } else {
                    return apiError("Forbidden: You are not authorized to scan this user.", 403);
                }
            }
        }

        // 3. Lookup participant
        const participant = await prisma.participant.findUnique({
            where: { id: participantId },
        });

        if (!participant) {
            return apiError(`Participant ${participantId} not found.`, 404);
        }

        // Household lead check: verify participant is in the same household
        if (pendingHouseholdCheck && auth.type === 'session') {
            if (participant.householdId !== auth.user.householdId) {
                return apiError("Forbidden: You are not authorized to scan this user.", 403);
            }
        }

        // Steps 4–6 (debounce read → record event → find visit → check-in/out)
        // are a read-modify-write on this participant's visit state. Without
        // serialization, two near-simultaneous scans for the same participant
        // both pass the debounce read and both observe the same visit state
        // before either writes — producing two open visits (double check-in) or
        // a double check-out that 500s on Prisma P2025 when the second tries to
        // delete the already-deleted visit. We wrap the whole sequence in one
        // transaction and take a per-participant Postgres advisory xact lock at
        // the top, so concurrent scans for the same participantId serialize: the
        // second blocks until the first commits, then observes committed state
        // and branches correctly. The lock auto-releases on commit/rollback.
        const authType = auth.type;

        const res = await prisma.$transaction(async (tx) => {
            // Per-participant lock. Serializes only same-participant scans;
            // different participants get different lock keys and never block.
            // $executeRaw (not $queryRaw): pg_advisory_xact_lock returns `void`,
            // which $queryRaw cannot deserialize. $executeRaw just runs it.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${participant.id})`;

            // 4. Double scan debounce check (3 seconds) — now under the lock, so
            // it sees the committed badge event of any racing scan ahead of it.
            const threeSecondsAgo = new Date(Date.now() - 3000);
            const recentScan = await tx.rawBadgeLog.findFirst({
                where: {
                    participantId: participant.id,
                    time: {
                        gte: threeSecondsAgo
                    }
                }
            });

            if (recentScan) {
                // Silently ignore to prevent accidental double-scans without disrupting UI
                return new Response(JSON.stringify({ type: 'ignored_debounce', message: 'Scan ignored due to debounce.' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 5. Record raw badge event
            await tx.rawBadgeLog.create({
                data: {
                    participantId: participant.id,
                    location: "Main Entrance",
                },
            });

            // 6. Check-in or check-out
            const activeVisit = await tx.visit.findFirst({
                where: {
                    participantId: participant.id,
                    departed: null,
                },
                orderBy: { arrived: "desc" },
            });

            if (activeVisit) {
                return await processCheckout(participant, activeVisit.id, authType, tx);
            } else {
                return await processCheckin(participant, authType, tx);
            }
        }, {
            // maxWait: time a racing scan waits to acquire a connection / start.
            // timeout: ceiling on the whole locked section, including time spent
            // blocked on pg_advisory_xact_lock while an earlier scan holds it.
            maxWait: 5000,
            timeout: 15000,
        });

        // Facility-wide close runs here, AFTER the per-participant transaction
        // commits and the advisory lock is released. Keeping the sweep + email
        // kick out of the locked section means a last-keyholder close no longer
        // blocks concurrent scans for other participants. No-op unless the
        // response reports facilityClosed.
        await finalizeFacilityClose(res);

        return res;
    } catch (error) {
        console.error("Scan processing error:", error);
        await logBackendError(error, "POST /api/scan");
        return apiError("Internal Server Error while processing scan.", 500);
    } finally {
        const durationMs = Date.now() - startTime;
        prisma.systemMetricLog.create({
            data: {
                metric: "scan_response_time",
                value: durationMs,
            }
        }).catch((err: unknown) => console.error("Failed to log scan_response_time metric:", err));
    }
}
