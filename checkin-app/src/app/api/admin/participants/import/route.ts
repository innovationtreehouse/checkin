import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateRequest } from "@/lib/auth";
import * as xlsx from "xlsx";
import { logBackendError } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const auth = await authenticateRequest(req);
        if (auth.type !== 'session') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (!auth.user.sysadmin && !auth.user.boardMember) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const formData = await req.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const workbook = xlsx.read(buffer, { type: "buffer" });

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

        if (rawData.length < 2) {
            return NextResponse.json({ error: "Empty spreadsheet or no data rows found" }, { status: 400 });
        }

        const headers = rawData[0].map((h: unknown) => String(h).trim().toLowerCase());
        const rows = rawData.slice(1);

        const emailIndex = headers.findIndex(h => h.includes("email") && !h.includes("parent") && !h.includes("household"));
        const parentEmailIndex = headers.findIndex(h => h.includes("parent email"));
        const firstNameIndex = headers.findIndex(h => h.includes("first name"));
        const lastNameIndex = headers.findIndex(h => h.includes("last name"));
        const dobIndex = headers.findIndex(h => h.includes("dob") || h.includes("date of birth"));
        const addressIndex = headers.findIndex(h => h.includes("address"));
        const sameHouseholdIndex = headers.findIndex(h => h.includes("same household as"));

        if (firstNameIndex === -1 || lastNameIndex === -1) {
            return NextResponse.json({ error: "Missing required 'First Name' or 'Last Name' columns." }, { status: 400 });
        }

        let insertedOrUpdatedCount = 0;
        const errors: string[] = [];

        // Helper: look up a participant's household. Every participant has one
        // (householdId is a required FK).
        const ensureHousehold = async (participantId: number): Promise<number> => {
            const participant = await prisma.participant.findUnique({ where: { id: participantId } });
            if (!participant) throw new Error(`Participant ${participantId} not found`);
            return participant.householdId;
        };

        // Helper: create a participant together with their own new household.
        // Adults (no DOB, or 18+) lead the household.
        const createParticipantWithHousehold = async (data: {
            email?: string;
            name: string;
            dob?: Date;
            address?: string;
        }) => {
            const isAdult = !data.dob || (new Date().getFullYear() - data.dob.getFullYear()) >= 18;
            const participant = await prisma.participant.create({
                data: {
                    ...(data.email && { email: data.email }),
                    name: data.name,
                    dob: data.dob,
                    household: {
                        create: {
                            name: `${data.name}'s Household`,
                            ...(data.address && { address: data.address }),
                        }
                    }
                }
            });
            if (isAdult) {
                await prisma.householdLead.create({
                    data: { householdId: participant.householdId, participantId: participant.id }
                });
            }
            return participant;
        };

        // Helper: addresses live on the household, not the participant.
        // A CSV address overwrites the row's household address when provided.
        const applyAddressToHousehold = async (householdId: number, address: string) => {
            if (!address) return;
            await prisma.household.update({
                where: { id: householdId },
                data: { address }
            });
        };

        // Helper: ensure an active household membership exists for a household
        const ensureHouseholdMembership = async (householdId: number) => {
            await prisma.membership.upsert({
                where: { householdId },
                create: { householdId, status: 'ACTIVE' },
                update: { status: 'ACTIVE' },
            });
        };

        // Parse all rows first
        interface ParsedRow {
            index: number;
            firstName: string;
            lastName: string;
            fullName: string;
            email: string;
            parentEmail: string;
            parsedDob?: Date;
            address: string;
            sameHouseholdAs: string;
        }

        const parsedRows: ParsedRow[] = [];
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const firstName = row[firstNameIndex]?.toString().trim() || "";
            const lastName = row[lastNameIndex]?.toString().trim() || "";
            const email = emailIndex !== -1 ? row[emailIndex]?.toString().trim() : "";
            const parentEmail = parentEmailIndex !== -1 ? row[parentEmailIndex]?.toString().trim() : "";
            const dobString = dobIndex !== -1 ? row[dobIndex]?.toString().trim() : "";
            const address = addressIndex !== -1 ? row[addressIndex]?.toString().trim() : "";
            const sameHouseholdAs = sameHouseholdIndex !== -1 ? row[sameHouseholdIndex]?.toString().trim() : "";

            if (!firstName && !lastName) continue;

            if (email && !emailRegex.test(email)) {
                errors.push(`Row ${i + 2} (${firstName} ${lastName}): Invalid email format`);
                continue;
            }

            if (parentEmail && !emailRegex.test(parentEmail)) {
                errors.push(`Row ${i + 2} (${firstName} ${lastName}): Invalid parent email format`);
                continue;
            }

            let parsedDob: Date | undefined;
            if (dobString) {
                // xlsx might parse it as an Excel serial number if no bookType provided, handle it if so
                if (/^\d+(\.\d+)?$/.test(dobString)) {
                    // Excel serial number
                    const serial = parseFloat(dobString);
                    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                    parsedDob = new Date(excelEpoch.getTime() + serial * 86400000);
                } else {
                    const d = new Date(dobString);
                    if (!isNaN(d.getTime())) parsedDob = d;
                }
            }

            parsedRows.push({
                index: i,
                firstName,
                lastName,
                fullName: `${firstName} ${lastName}`.trim(),
                email: email || "",
                parentEmail: parentEmail || "",
                parsedDob,
                address: address || "",
                sameHouseholdAs: sameHouseholdAs || "",
            });
        }

        // ===== PASS 1: Create/update all participants (no household linking yet) =====
        // Track created participant IDs by email and name for pass 2
        const participantByEmail = new Map<string, number>(); // email -> participantId
        const participantByName = new Map<string, number>(); // lowercase name -> participantId

        for (const pr of parsedRows) {
            try {
                let participantId: number;

                if (pr.email) {
                    let participant = await prisma.participant.findUnique({ where: { email: pr.email } });
                    if (participant) {
                        participant = await prisma.participant.update({
                            where: { id: participant.id },
                            data: {
                                name: pr.fullName,
                                dob: pr.parsedDob ?? participant.dob,
                            }
                        });
                        await applyAddressToHousehold(participant.householdId, pr.address);
                    } else {
                        participant = await createParticipantWithHousehold({
                            email: pr.email,
                            name: pr.fullName,
                            dob: pr.parsedDob,
                            address: pr.address,
                        });
                    }
                    participantId = participant.id;
                    participantByEmail.set(pr.email.toLowerCase(), participantId);
                } else if (pr.parentEmail) {
                    // Ensure parent exists (new parents get their own household)
                    let parent = await prisma.participant.findUnique({ where: { email: pr.parentEmail } });
                    if (!parent) {
                        parent = await createParticipantWithHousehold({
                            email: pr.parentEmail,
                            name: pr.parentEmail.split('@')[0],
                        });
                        participantByEmail.set(pr.parentEmail.toLowerCase(), parent.id);
                    }

                    const parentHouseholdId = await ensureHousehold(parent.id);

                    // Find or create child in that household
                    let participant = await prisma.participant.findFirst({
                        where: { householdId: parentHouseholdId, name: pr.fullName }
                    });
                    if (participant) {
                        participant = await prisma.participant.update({
                            where: { id: participant.id },
                            data: {
                                dob: pr.parsedDob ?? participant.dob,
                            }
                        });
                    } else {
                        participant = await prisma.participant.create({
                            data: {
                                name: pr.fullName,
                                dob: pr.parsedDob,
                                householdId: parentHouseholdId
                            }
                        });
                    }
                    participantId = participant.id;
                    await applyAddressToHousehold(parentHouseholdId, pr.address);

                    // Ensure membership
                    await ensureHouseholdMembership(parentHouseholdId);
                } else {
                    // No email, no parent email — find by name/DOB
                    const matchQuery: { name: string; dob?: Date } = { name: pr.fullName };
                    if (pr.parsedDob) matchQuery.dob = pr.parsedDob;

                    let participant = await prisma.participant.findFirst({ where: matchQuery });
                    if (participant) {
                        await applyAddressToHousehold(participant.householdId, pr.address);
                    } else {
                        participant = await createParticipantWithHousehold({
                            name: pr.fullName,
                            dob: pr.parsedDob,
                            address: pr.address,
                        });
                    }
                    participantId = participant.id;
                }

                participantByName.set(pr.fullName.toLowerCase(), participantId);
                insertedOrUpdatedCount++;

            } catch (err: unknown) {
                console.error(`Error processing row ${pr.index + 2}:`, err);
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                errors.push(`Row ${pr.index + 2} (${pr.fullName || 'Unknown'}): ${errorMessage}`);
            }
        }

        // ===== PASS 2: Resolve households =====
        // Helper to resolve a "Same Household As" reference (checks DB + this import batch)
        const resolveHouseholdRef = async (ref: string): Promise<{ householdId: number; refParticipantId: number } | null> => {
            const trimmed = ref.trim();
            if (!trimmed) return null;

            // Try by email (check batch first, then DB)
            if (trimmed.includes('@')) {
                const batchId = participantByEmail.get(trimmed.toLowerCase());
                if (batchId) {
                    const hhId = await ensureHousehold(batchId);
                    return { householdId: hhId, refParticipantId: batchId };
                }
                const byEmail = await prisma.participant.findUnique({
                    where: { email: trimmed },
                    select: { id: true, householdId: true }
                });
                if (byEmail) {
                    return { householdId: byEmail.householdId, refParticipantId: byEmail.id };
                }
            }

            // Try by name (check batch first, then DB)
            const batchId = participantByName.get(trimmed.toLowerCase());
            if (batchId) {
                const hhId = await ensureHousehold(batchId);
                return { householdId: hhId, refParticipantId: batchId };
            }

            const byName = await prisma.participant.findFirst({
                where: { name: { equals: trimmed, mode: 'insensitive' } },
                select: { id: true, householdId: true }
            });
            if (byName) {
                return { householdId: byName.householdId, refParticipantId: byName.id };
            }

            return null;
        };

        for (const pr of parsedRows) {
            try {
                // Get participant ID from our tracking maps
                const participantId = pr.email
                    ? participantByEmail.get(pr.email.toLowerCase())
                    : participantByName.get(pr.fullName.toLowerCase());

                if (!participantId) continue;

                // Handle "Same Household As"
                if (pr.sameHouseholdAs) {
                    const resolved = await resolveHouseholdRef(pr.sameHouseholdAs);
                    if (resolved) {
                        const targetHouseholdId = resolved.householdId;
                        
                        // Get the participant's current household (might have just been created in Pass 1)
                        const participant = await prisma.participant.findUnique({
                            where: { id: participantId },
                            select: { householdId: true }
                        });

                        const sourceHouseholdId = participant?.householdId;

                        // If they are already in the target household, do nothing
                        if (sourceHouseholdId === targetHouseholdId || !sourceHouseholdId) {
                            continue;
                        }

                        // Merge the ENTIRE source household into the target.
                        // Move all participants from source to target
                        await prisma.participant.updateMany({
                            where: { householdId: sourceHouseholdId },
                            data: { householdId: targetHouseholdId }
                        });

                        // Move all leads from source to target
                        const sourceLeads = await prisma.householdLead.findMany({
                            where: { householdId: sourceHouseholdId }
                        });

                        for (const lead of sourceLeads) {
                            await prisma.householdLead.upsert({
                                where: {
                                    householdId_participantId: {
                                        householdId: targetHouseholdId,
                                        participantId: lead.participantId
                                    }
                                },
                                update: {},
                                create: {
                                    householdId: targetHouseholdId,
                                    participantId: lead.participantId
                                }
                            });
                        }

                        // Delete memberships and leads from the old source household
                        await prisma.membership.deleteMany({ where: { householdId: sourceHouseholdId } });
                        await prisma.householdLead.deleteMany({ where: { householdId: sourceHouseholdId } });

                        // Finally delete the source household (empty now, so the
                        // RESTRICT FK allows it)
                        await prisma.household.delete({ where: { id: sourceHouseholdId } });

                        // If the row that initiated the merge is an adult with an email, ensure they are a lead
                        if (pr.email) {
                            await prisma.householdLead.upsert({
                                where: {
                                    householdId_participantId: {
                                        householdId: targetHouseholdId,
                                        participantId: participantId
                                    }
                                },
                                update: {},
                                create: {
                                    householdId: targetHouseholdId,
                                    participantId: participantId
                                }
                            });
                        }

                        await ensureHouseholdMembership(targetHouseholdId);
                    } else {
                        errors.push(`Row ${pr.index + 2} (${pr.fullName}): Could not find participant "${pr.sameHouseholdAs}" for household association`);
                    }
                }
                // Every participant got a household in pass 1 (or already had
                // one) — just make sure the membership exists.
                else {
                    const participant = await prisma.participant.findUnique({ where: { id: participantId } });
                    if (participant) {
                        await ensureHouseholdMembership(participant.householdId);
                    }
                }
            } catch (err: unknown) {
                console.error(`Error in pass 2 for row ${pr.index + 2}:`, err);
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                errors.push(`Row ${pr.index + 2} (${pr.fullName}): Household linking error: ${errorMessage}`);
            }
        }

        return NextResponse.json({
            success: true,
            message: `Successfully imported or updated ${insertedOrUpdatedCount} participants.`,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error: unknown) {
        await logBackendError(error, "POST /api/admin/participants/import");
        return NextResponse.json({ error: `Internal server error` }, { status: 500 });
    }
}
