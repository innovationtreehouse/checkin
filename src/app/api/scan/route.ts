import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateRequest } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { processCheckin, processCheckout } from "@/lib/scan-service";
import { logBackendError } from "@/lib/logger";

export async function POST(req: NextRequest) {
    const startTime = Date.now();
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
            if (isSelf && !isAdmin && process.env.NODE_ENV === 'production') {
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

        // 4. Record raw badge event
        await prisma.rawBadgeEvent.create({
            data: {
                participantId: participant.id,
                location: "Main Entrance",
            },
        });

        // 5. Check-in or check-out
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
    } catch (error) {
        console.error("Scan processing error:", error);
        await logBackendError(error, "POST /api/scan");
        return apiError("Internal Server Error while processing scan.", 500);
    } finally {
        const durationMs = Date.now() - startTime;
        prisma.systemMetric.create({
            data: {
                metric: "scan_response_time",
                value: durationMs,
            }
        }).catch((err: unknown) => console.error("Failed to log scan_response_time metric:", err));
    }
}
