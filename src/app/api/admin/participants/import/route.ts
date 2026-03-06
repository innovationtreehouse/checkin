import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import prisma from "@/lib/prisma";
import * as xlsx from "xlsx";

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const user = session.user as any;
        if (!user.sysadmin && !user.boardMember) {
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

        const rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (rawData.length < 2) {
            return NextResponse.json({ error: "Empty spreadsheet or no data rows found" }, { status: 400 });
        }

        const headers = rawData[0].map((h: any) => String(h).trim().toLowerCase());
        const rows = rawData.slice(1);

        const emailIndex = headers.findIndex(h => h.includes("email") && !h.includes("parent") && !h.includes("household"));
        const parentEmailIndex = headers.findIndex(h => h.includes("parent email"));
        const firstNameIndex = headers.findIndex(h => h.includes("first name"));
        const lastNameIndex = headers.findIndex(h => h.includes("last name"));
        const dobIndex = headers.findIndex(h => h.includes("dob"));
        const addressIndex = headers.findIndex(h => h.includes("address"));
        const sameHouseholdIndex = headers.findIndex(h => h.includes("same household as"));

        if (firstNameIndex === -1 || lastNameIndex === -1) {
            return NextResponse.json({ error: "Missing required 'First Name' or 'Last Name' columns." }, { status: 400 });
        }

        let insertedOrUpdatedCount = 0;
        let errors: string[] = [];

        // Helper: find or create household for a participant
        const ensureHousehold = async (participantId: number, participantName: string): Promise<number> => {
            const participant = await prisma.participant.findUnique({ where: { id: participantId } });
            if (participant?.householdId) {
                return participant.householdId;
            }

            const newHousehold = await prisma.household.create({
                data: {
                    name: `${participantName}'s Household`,
                    leads: {
                        create: {
                            participantId: participantId
                        }
                    }
                }
            });

            await prisma.participant.update({
                where: { id: participantId },
                data: { householdId: newHousehold.id }
            });

            return newHousehold.id;
        };

        // Helper: ensure a HOUSEHOLD membership exists for a household
        const ensureHouseholdMembership = async (householdId: number) => {
            const existingMembership = await prisma.membership.findFirst({
                where: { householdId, type: 'HOUSEHOLD', active: true }
            });
            if (!existingMembership) {
                await prisma.membership.create({
                    data: {
                        householdId,
                        type: 'HOUSEHOLD',
                        active: true,
                    }
                });
            }
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

            let parsedDob: Date | undefined;
            if (dobString) {
                const d = new Date(dobString);
                if (!isNaN(d.getTime())) parsedDob = d;
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
                                homeAddress: pr.address || participant.homeAddress
                            }
                        });
                    } else {
                        participant = await prisma.participant.create({
                            data: {
                                email: pr.email,
                                name: pr.fullName,
                                dob: pr.parsedDob,
                                homeAddress: pr.address
                            }
                        });
                    }
                    participantId = participant.id;
                    participantByEmail.set(pr.email.toLowerCase(), participantId);
                } else if (pr.parentEmail) {
                    // Ensure parent exists
                    let parent = await prisma.participant.findUnique({ where: { email: pr.parentEmail } });
                    if (!parent) {
                        parent = await prisma.participant.create({
                            data: {
                                email: pr.parentEmail,
                                name: pr.parentEmail.split('@')[0],
                            }
                        });
                        participantByEmail.set(pr.parentEmail.toLowerCase(), parent.id);
                    }

                    // Ensure parent has a household
                    const parentHouseholdId = await ensureHousehold(parent.id, parent.name || 'Unnamed');

                    // Find or create child in that household
                    let participant = await prisma.participant.findFirst({
                        where: { householdId: parentHouseholdId, name: pr.fullName }
                    });
                    if (participant) {
                        participant = await prisma.participant.update({
                            where: { id: participant.id },
                            data: {
                                dob: pr.parsedDob ?? participant.dob,
                                homeAddress: pr.address || participant.homeAddress
                            }
                        });
                    } else {
                        participant = await prisma.participant.create({
                            data: {
                                name: pr.fullName,
                                dob: pr.parsedDob,
                                homeAddress: pr.address,
                                householdId: parentHouseholdId
                            }
                        });
                    }
                    participantId = participant.id;

                    // Ensure membership
                    await ensureHouseholdMembership(parentHouseholdId);
                } else {
                    // No email, no parent email — find by name/DOB
                    let matchQuery: any = { name: pr.fullName };
                    if (pr.parsedDob) matchQuery.dob = pr.parsedDob;

                    let participant = await prisma.participant.findFirst({ where: matchQuery });
                    if (participant) {
                        participant = await prisma.participant.update({
                            where: { id: participant.id },
                            data: { homeAddress: pr.address || participant.homeAddress }
                        });
                    } else {
                        participant = await prisma.participant.create({
                            data: {
                                name: pr.fullName,
                                dob: pr.parsedDob,
                                homeAddress: pr.address
                            }
                        });
                    }
                    participantId = participant.id;
                }

                participantByName.set(pr.fullName.toLowerCase(), participantId);
                insertedOrUpdatedCount++;

            } catch (err: any) {
                console.error(`Error processing row ${pr.index + 2}:`, err);
                errors.push(`Row ${pr.index + 2} (${pr.fullName || 'Unknown'}): ${err.message || 'Unknown error'}`);
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
                    const hhId = await ensureHousehold(batchId, trimmed);
                    return { householdId: hhId, refParticipantId: batchId };
                }
                const byEmail = await prisma.participant.findUnique({
                    where: { email: trimmed },
                    select: { id: true, name: true }
                });
                if (byEmail) {
                    const hhId = await ensureHousehold(byEmail.id, byEmail.name || 'Unnamed');
                    return { householdId: hhId, refParticipantId: byEmail.id };
                }
            }

            // Try by name (check batch first, then DB)
            const batchId = participantByName.get(trimmed.toLowerCase());
            if (batchId) {
                const p = await prisma.participant.findUnique({ where: { id: batchId }, select: { name: true } });
                const hhId = await ensureHousehold(batchId, p?.name || trimmed);
                return { householdId: hhId, refParticipantId: batchId };
            }

            const byName = await prisma.participant.findFirst({
                where: { name: { equals: trimmed, mode: 'insensitive' } },
                select: { id: true, name: true }
            });
            if (byName) {
                const hhId = await ensureHousehold(byName.id, byName.name || 'Unnamed');
                return { householdId: hhId, refParticipantId: byName.id };
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
                        if (sourceHouseholdId === targetHouseholdId) {
                            continue;
                        }

                        // If they have a household, we must merge the ENTIRE source household into the target
                        if (sourceHouseholdId) {
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

                            // Finally delete the source household
                            await prisma.household.delete({ where: { id: sourceHouseholdId } });
                        } else {
                            // They don't have a household yet, just add them to the target
                            await prisma.participant.update({
                                where: { id: participantId },
                                data: { householdId: targetHouseholdId }
                            });
                        }

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
                // For adults with email who didn't use "Same Household As" or "Parent Email",
                // ensure they have their own household
                else if (pr.email && !pr.parentEmail) {
                    const participant = await prisma.participant.findUnique({ where: { id: participantId } });
                    if (participant && !participant.householdId) {
                        const hhId = await ensureHousehold(participantId, pr.fullName);
                        await ensureHouseholdMembership(hhId);
                    } else if (participant?.householdId) {
                        await ensureHouseholdMembership(participant.householdId);
                    }
                }
            } catch (err: any) {
                console.error(`Error in pass 2 for row ${pr.index + 2}:`, err);
                errors.push(`Row ${pr.index + 2} (${pr.fullName}): Household linking error: ${err.message || 'Unknown error'}`);
            }
        }

        return NextResponse.json({
            success: true,
            message: `Successfully imported or updated ${insertedOrUpdatedCount} participants.`,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error("Error in participant bulk import:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
