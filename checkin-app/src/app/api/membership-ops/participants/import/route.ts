import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import * as xlsx from "xlsx";
import { logBackendError } from "@/lib/logger";
import { addHouseholdLead, HouseholdLeadLimitError, MAX_HOUSEHOLD_LEADS } from "@/lib/household/leads";
import { parseImportDob } from "@/lib/importDob";
import { calculateAge } from "@/lib/time";
import type { DbClient } from "@/lib/db-client";

export const POST = withAuth({ roles: ['isSysadmin', 'isBoardMember'] }, async (req: NextRequest, auth) => {
    try {
        if (auth.type !== 'session') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        const ensureHousehold = async (participantId: number, db: DbClient = prisma): Promise<number> => {
            const participant = await db.person.findUnique({ where: { id: participantId } });
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
        }, db: DbClient = prisma) => {
            const isAdult = !data.dob || calculateAge(data.dob) >= 18;
            const participant = await db.person.create({
                data: {
                    ...(data.email && { email: data.email }),
                    name: data.name,
                    dateOfBirth: data.dob,
                    household: {
                        create: {
                            name: `${data.name}'s Household`,
                            ...(data.address && { address: data.address }),
                        }
                    }
                }
            });
            if (isAdult) {
                await addHouseholdLead(db, participant.householdId, participant.id);
            }
            return participant;
        };

        // Helper: addresses live on the household, not the participant.
        // A CSV address overwrites the row's household address when provided.
        // ponytail: legacy CSV has one free-text address column → goes to line1
        // verbatim. Bulk import is being redone; structured columns land then.
        const applyAddressToHousehold = async (householdId: number, address: string, db: DbClient = prisma) => {
            if (!address) return;
            await db.household.update({
                where: { id: householdId },
                data: { line1: address }
            });
        };

        // Helper: ensure an active household membership exists for a household
        const ensureHouseholdMembership = async (
            householdId: number,
            db: DbClient = prisma,
        ) => {
            await db.membership.upsert({
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

            const parsedDob = parseImportDob(dobString);

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
                // Each row's writes run in one transaction so a row either fully
                // lands or fully rolls back — no half-linked participants left behind.
                const participantId = await prisma.$transaction(async (tx) => {
                    let participantId: number;

                    if (pr.email) {
                        let participant = await tx.person.findUnique({ where: { email: pr.email } });
                        if (participant) {
                            participant = await tx.person.update({
                                where: { id: participant.id },
                                data: {
                                    name: pr.fullName,
                                    dateOfBirth: pr.parsedDob ?? participant.dateOfBirth,
                                }
                            });
                            await applyAddressToHousehold(participant.householdId, pr.address, tx);
                        } else {
                            participant = await createParticipantWithHousehold({
                                email: pr.email,
                                name: pr.fullName,
                                dob: pr.parsedDob,
                                address: pr.address,
                            }, tx);
                        }
                        participantId = participant.id;
                        participantByEmail.set(pr.email.toLowerCase(), participantId);
                    } else if (pr.parentEmail) {
                        // Ensure parent exists (new parents get their own household)
                        let parent = await tx.person.findUnique({ where: { email: pr.parentEmail } });
                        if (!parent) {
                            parent = await createParticipantWithHousehold({
                                email: pr.parentEmail,
                                name: pr.parentEmail.split('@')[0],
                            }, tx);
                            participantByEmail.set(pr.parentEmail.toLowerCase(), parent.id);
                        }

                        const parentHouseholdId = await ensureHousehold(parent.id, tx);

                        // Find or create child in that household
                        let participant = await tx.person.findFirst({
                            where: { householdId: parentHouseholdId, name: pr.fullName }
                        });
                        if (participant) {
                            participant = await tx.person.update({
                                where: { id: participant.id },
                                data: {
                                    dateOfBirth: pr.parsedDob ?? participant.dateOfBirth,
                                }
                            });
                        } else {
                            participant = await tx.person.create({
                                data: {
                                    name: pr.fullName,
                                    dateOfBirth: pr.parsedDob,
                                    householdId: parentHouseholdId
                                }
                            });
                        }
                        participantId = participant.id;
                        await applyAddressToHousehold(parentHouseholdId, pr.address, tx);

                        // Ensure membership
                        await ensureHouseholdMembership(parentHouseholdId, tx);
                    } else {
                        // No email, no parent email — find by name/DOB
                        const matchQuery: { name: string; dateOfBirth?: Date } = { name: pr.fullName };
                        if (pr.parsedDob) matchQuery.dateOfBirth = pr.parsedDob;

                        let participant = await tx.person.findFirst({ where: matchQuery });
                        if (participant) {
                            await applyAddressToHousehold(participant.householdId, pr.address, tx);
                        } else {
                            participant = await createParticipantWithHousehold({
                                name: pr.fullName,
                                dob: pr.parsedDob,
                                address: pr.address,
                            }, tx);
                        }
                        participantId = participant.id;
                    }

                    return participantId;
                });

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
                const byEmail = await prisma.person.findUnique({
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

            const byName = await prisma.person.findFirst({
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
                        const participant = await prisma.person.findUnique({
                            where: { id: participantId },
                            select: { householdId: true }
                        });

                        const sourceHouseholdId = participant?.householdId;

                        // If they are already in the target household, do nothing
                        if (sourceHouseholdId === targetHouseholdId || !sourceHouseholdId) {
                            continue;
                        }

                        // Merge the ENTIRE source household into the target.
                        const sourceLeads = await prisma.householdLead.findMany({
                            where: { householdId: sourceHouseholdId }
                        });

                        // Enforce the 2-lead cap (#269) BEFORE mutating: reject
                        // the merge up front rather than start a doomed transaction.
                        const projectedLeadIds = new Set(
                            (await prisma.householdLead.findMany({
                                where: { householdId: targetHouseholdId },
                                select: { personId: true }
                            })).map((l) => l.personId)
                        );
                        for (const l of sourceLeads) projectedLeadIds.add(l.personId);
                        if (pr.email) projectedLeadIds.add(participantId);
                        if (projectedLeadIds.size > MAX_HOUSEHOLD_LEADS) {
                            throw new HouseholdLeadLimitError(targetHouseholdId);
                        }

                        // Atomic: if any step throws, the whole merge rolls back so
                        // participants are never left half-moved between households.
                        await prisma.$transaction(async (tx) => {
                            // Move all participants from source to target
                            await tx.person.updateMany({
                                where: { householdId: sourceHouseholdId },
                                data: { householdId: targetHouseholdId }
                            });

                            // Move all leads from source to target
                            for (const lead of sourceLeads) {
                                await addHouseholdLead(tx, targetHouseholdId, lead.personId);
                            }

                            // Delete memberships and leads from the old source household
                            await tx.membership.deleteMany({ where: { householdId: sourceHouseholdId } });
                            await tx.householdLead.deleteMany({ where: { householdId: sourceHouseholdId } });

                            // Finally delete the source household (empty now, so the
                            // RESTRICT FK allows it)
                            await tx.household.delete({ where: { id: sourceHouseholdId } });

                            // If the row that initiated the merge is an adult with an email, ensure they are a lead
                            if (pr.email) {
                                await addHouseholdLead(tx, targetHouseholdId, participantId);
                            }

                            await ensureHouseholdMembership(targetHouseholdId, tx);
                        });
                    } else {
                        errors.push(`Row ${pr.index + 2} (${pr.fullName}): Could not find participant "${pr.sameHouseholdAs}" for household association`);
                    }
                }
                // Every participant got a household in pass 1 (or already had
                // one) — just make sure the membership exists.
                else {
                    const participant = await prisma.person.findUnique({ where: { id: participantId } });
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
        if (error instanceof HouseholdLeadLimitError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        await logBackendError(error, "POST /api/membership-ops/participants/import");
        return NextResponse.json({ error: `Internal server error` }, { status: 500 });
    }
});
