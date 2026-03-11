import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getKioskPublicKey, verifyKioskSignature } from "@/lib/verify-kiosk";
import { sendCheckinNotifications } from "@/lib/notifications";
import { getFullAttendance } from "@/lib/getFullAttendance";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { logBackendError } from "@/lib/logger";

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    console.log("--> API /api/scan HIT");
    try {
        const rawBody = await req.text();

        let authStatus = "unauthorized";
        let kioskError = "";

        // 1. Kiosk Signature Authorization
        const pubKey = getKioskPublicKey();
        if (pubKey) {
            const signatureResult = verifyKioskSignature(
                "POST",
                "/api/scan",
                rawBody,
                req.headers.get("x-kiosk-timestamp"),
                req.headers.get("x-kiosk-signature"),
                pubKey
            );
            if (signatureResult.ok) {
                authStatus = "kiosk";
            } else {
                kioskError = signatureResult.error;
            }
        } else {
            // Dev mode: no key configured, treat as kiosk authorized if it looks like a kiosk request
            // or if we just want to allow everything in dev.
            // Following the pattern in /api/attendance/route.ts:
            authStatus = "kiosk";
        }

        const body = JSON.parse(rawBody);
        const participantId = body.participantId;
        console.log(`Parsed body, participantId: ${participantId}`);

        if (!participantId) {
            return NextResponse.json(
                { error: "participantId is required." },
                { status: 400 }
            );
        }

        // 2. Web Session Authorization (only if not already authorized as a kiosk)
        let isWebAuthorized = false;
        let pendingHouseholdCheck = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let user: any = null;

        if (authStatus !== "kiosk") {
            const session = await getServerSession(authOptions);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user = session?.user as any;

            if (user) {
                const isSelf = participantId === Number(user.id);
                const isAdmin = user.sysadmin || user.keyholder || user.boardMember;

                if (isSelf || isAdmin) {
                    isWebAuthorized = true;
                    authStatus = "web";
                } else if (user.householdId && user.householdLead) {
                    pendingHouseholdCheck = true;
                }
            }
        }

        if (authStatus === "unauthorized" && !pendingHouseholdCheck) {
            console.log(`Scan rejected: Kiosk error (${kioskError || "missing"}) and no valid web session.`);
            return NextResponse.json({ error: "Unauthorized: Missing kiosk signature or invalid session" }, { status: 401 });
        }

        console.log("Checking if participant exists...");
        const participant = await prisma.participant.findUnique({
            where: { id: participantId },
        });
        console.log(`Participant lookup result: ${participant ? participant.email : 'null'}`);

        if (!participant) {
            return NextResponse.json(
                { error: `Participant ${participantId} not found.` },
                { status: 404 }
            );
        }

        if (pendingHouseholdCheck) {
            if (participant.householdId === user.householdId) {
                isWebAuthorized = true;
            } else {
                return NextResponse.json({ error: "Forbidden: You are not authorized to scan this user." }, { status: 403 });
            }
        }
        
        // Use the assigned variable here just so it's not marked unused, even if redundant
        if (!isWebAuthorized && authStatus === "web") {
            console.log("Web Auth succeeded but isWebAuthorized flag wasn't set.");
        }

        console.log("Logging raw badge event...");
        await prisma.rawBadgeEvent.create({
            data: {
                participantId: participant.id,
                location: "Main Entrance", // Or from request if multiple scanners exist
            },
        });
        console.log("Raw event logged.");

        console.log("Checking active visits...");
        // Step 3: Check for an active open visit (i.e. check-in without check-out)
        const activeVisit = await prisma.visit.findFirst({
            where: {
                participantId: participant.id,
                departed: null, // Still in the building
            },
            orderBy: { arrived: "desc" },
        });
        console.log(`Active visit found: ${activeVisit ? 'Yes' : 'No'}`);

        if (activeVisit) {
            let facilityClosed = false;

            // Check if they were a keyholder
            if (participant.keyholder) {
                // Count how many OTHER keyholders are still in the building
                const remainingKeyholders = await prisma.visit.count({
                    where: {
                        departed: null,
                        participant: { keyholder: true },
                        id: { not: activeVisit.id }
                    }
                });

                // If 0 remaining, check if there are other users
                if (remainingKeyholders === 0) {
                    const remainingUsers = await prisma.visit.findMany({
                        where: {
                            departed: null,
                            id: { not: activeVisit.id }
                        },
                        include: { participant: true }
                    });

                    if (remainingUsers.length > 0) {
                        let confirmForceClose = false;

                        // Check if they badged recently to confirm
                        const recentEvents = await prisma.rawBadgeEvent.findMany({
                            where: { participantId: participant.id },
                            orderBy: { time: "desc" },
                            take: 2
                        });

                        if (recentEvents.length === 2) {
                            const timeDiff = recentEvents[0].time.getTime() - recentEvents[1].time.getTime();
                            if (timeDiff <= 12000) { // Within ~10-12 seconds
                                confirmForceClose = true;
                            }
                        }

                        if (!confirmForceClose) {
                            // Do not log them out. Flash a warning.
                            const names = remainingUsers.map(u => u.participant.name || u.participant.email).join(", ");
                            return NextResponse.json({
                                error: `Warning! You are the last keyholder, but others are here:\n${names}\n\nBadge again within 10 seconds to confirm you've checked them and close the facility.`,
                                type: "warning"
                            }, { status: 400 });
                        }
                    }

                    facilityClosed = true;
                    // Forcibly checkout all remaining attendees
                    await prisma.visit.updateMany({
                        where: { departed: null },
                        data: { departed: new Date() }
                    });
                    console.log("Facility closed. Forcibly checked out all remaining members.");
                    
                    // Trigger post-event emails immediately for any events that finished today
                    // Use dynamic import so we don't block the API response
                    import("@/lib/postEventEmails").then(({ processPostEventEmails }) => {
                        processPostEventEmails({ forceImmediate: true }).catch(err => {
                            console.error("Failed to run post-event emails on facility close:", err);
                        });
                    });
                }
            }

            // User is already checked in, so we Check them Out
            const finalVisits = await processVisitCheckout(activeVisit.id, new Date());
            const updatedVisit = finalVisits.length > 0 ? finalVisits[finalVisits.length - 1] : activeVisit;

            // Fire-and-forget: send check-out notifications

            const checkoutAttendance = await getFullAttendance();
            return NextResponse.json({
                message: facilityClosed ? "Checked out and Facility closed" : "Checked out successfully",
                type: "checkout",
                participant,
                visit: updatedVisit,
                facilityClosed,
                signedRequest: authStatus === "kiosk",
                ...checkoutAttendance,
            });
        } else {
            // User is not checked in, so we Check them In

            // Phase 2: Check if facility is open (i.e. at least 1 keyholder present)
            if (!participant.keyholder) {
                const activeKeyholders = await prisma.visit.count({
                    where: {
                        departed: null,
                        participant: { keyholder: true }
                    }
                });

                if (activeKeyholders === 0) {
                    return NextResponse.json(
                        { error: "Facility is closed. A Keyholder must check in first." },
                        { status: 403 }
                    );
                }
            }

            const arrivalTime = new Date();
            const eventId = await findAssociatedEventAt(participant.id, arrivalTime);

            const newVisit = await prisma.visit.create({
                data: {
                    participantId: participant.id,
                    arrived: arrivalTime,
                    associatedEventId: eventId
                },
            });

            // Fire-and-forget: send check-in notifications
            sendCheckinNotifications(participant.id, 'checkin').catch(err =>
                console.error('Checkin notification error:', err)
            );

            const checkinAttendance = await getFullAttendance();
            return NextResponse.json({
                message: "Checked in successfully",
                type: "checkin",
                participant,
                visit: newVisit,
                signedRequest: authStatus === "kiosk",
                ...checkinAttendance,
            });
        }
    } catch (error) {
        console.error("Scan processing error:", error);
        await logBackendError(error, "POST /api/scan");
        return NextResponse.json(
            { error: "Internal Server Error while processing scan." },
            { status: 500 }
        );
    } finally {
        const durationMs = Date.now() - startTime;
        console.log(`API /api/scan completed in ${durationMs}ms`);
        // Fire-and-forget: log system metric
        prisma.systemMetric.create({
            data: {
                metric: "scan_response_time",
                value: durationMs,
            }
        }).catch((err: unknown) => console.error("Failed to log scan_response_time metric:", err));
    }
}
