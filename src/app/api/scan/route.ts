import prisma from "@/lib/prisma";
import { processCheckin, processCheckout } from "@/lib/scan-service";
import { logBackendError } from "@/lib/logger";
import { ApiResponseError, badRequest, forbidden, handler, notFound } from "@/security/handler";

// Admits either a verified kiosk badge scan or an authenticated session.
// The framework's `anyOf: ['kiosk', 'authenticated']` gate runs HMAC for
// the kiosk path, so `ctx.rawBody` is already populated with the verified
// bytes — DO NOT call `req.text()` here, parse JSON from rawBody instead.
export const POST = handler('POST /api/scan', async ({ auth, rawBody }) => {
    const startTime = Date.now();
    try {
        let body;
        try {
            body = JSON.parse(rawBody!);
        } catch {
            throw badRequest("Invalid JSON payload.");
        }

        const participantId = body.participantId;

        if (!participantId || typeof participantId !== 'number') {
            throw badRequest("A valid numeric participantId is required.");
        }

        // Authorization (the framework already admitted us as kiosk or session;
        // these checks add the row-level rules the gate can't express).
        let pendingHouseholdCheck = false;
        if (auth.type === 'session') {
            const user = auth.user;
            const isSelf = participantId === Number(user.id);
            const isAdmin = user.sysadmin || user.keyholder || user.boardMember;

            // In production, only privileged users may self-check-in via web.
            // Everyone else must use the kiosk badge scanner.
            if (isSelf && !isAdmin && process.env.NODE_ENV === 'production') {
                throw forbidden("Please use the kiosk badge scanner to check in.");
            }

            if (!isSelf && !isAdmin) {
                if (user.householdId && user.householdLead) {
                    pendingHouseholdCheck = true;
                } else {
                    throw forbidden("Forbidden: You are not authorized to scan this user.");
                }
            }
        }

        // Lookup participant
        const participant = await prisma.participant.findUnique({
            where: { id: participantId },
        });

        if (!participant) {
            throw notFound(`Participant ${participantId} not found.`);
        }

        // Household lead check: verify participant is in the same household
        if (pendingHouseholdCheck && auth.type === 'session') {
            if (participant.householdId !== auth.user.householdId) {
                throw forbidden("Forbidden: You are not authorized to scan this user.");
            }
        }

        // Double scan debounce check (3 seconds)
        const threeSecondsAgo = new Date(Date.now() - 3000);
        const recentScan = await prisma.rawBadgeEvent.findFirst({
            where: {
                participantId: participant.id,
                time: {
                    gte: threeSecondsAgo
                }
            }
        });

        if (recentScan) {
            // Silently ignore to prevent accidental double-scans without disrupting UI
            return { type: 'ignored_debounce', message: 'Scan ignored due to debounce.' };
        }

        // Record raw badge event
        await prisma.rawBadgeEvent.create({
            data: {
                participantId: participant.id,
                location: "Main Entrance",
            },
        });

        // Check-in or check-out
        const activeVisit = await prisma.visit.findFirst({
            where: {
                participantId: participant.id,
                departed: null,
            },
            orderBy: { arrived: "desc" },
        });

        const authType = auth.type;

        if (activeVisit) {
            return await processCheckout(participant, activeVisit.id, authType);
        } else {
            return await processCheckin(participant, authType);
        }
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        console.error("Scan processing error:", err);
        await logBackendError(err, "POST /api/scan");
        throw err;
    } finally {
        const durationMs = Date.now() - startTime;
        prisma.systemMetric.create({
            data: {
                metric: "scan_response_time",
                value: durationMs,
            }
        }).catch((err: unknown) => console.error("Failed to log scan_response_time metric:", err));
    }
});
