/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateRequest } from "@/lib/auth";
import * as xlsx from "xlsx";

type RowStatus = "ready" | "update" | "warning" | "error";

interface RowPreview {
    rowNumber: number;
    data: {
        firstName: string;
        lastName: string;
        email: string;
        parentEmail: string;
        dob: string;
        address: string;
        sameHouseholdAs: string;
    };
    status: RowStatus;
    action: string;
    warnings: string[];
    existingParticipant?: { id: number; name: string | null };
}

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
        const dobIndex = headers.findIndex(h => h.includes("dob") || h.includes("date of birth"));
        const addressIndex = headers.findIndex(h => h.includes("address"));
        const sameHouseholdIndex = headers.findIndex(h => h.includes("same household as"));

        if (firstNameIndex === -1 || lastNameIndex === -1) {
            return NextResponse.json({ error: "Missing required 'First Name' or 'Last Name' columns." }, { status: 400 });
        }

        // Parse all rows first so we can check cross-references
        interface ParsedRow {
            rowNumber: number;
            firstName: string;
            lastName: string;
            fullName: string;
            email: string;
            parentEmail: string;
            dobString: string;
            address: string;
            sameHouseholdAs: string;
        }

        const parsedRows: ParsedRow[] = [];
        const batchEmails = new Set<string>();
        const batchNames = new Set<string>();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const firstName = row[firstNameIndex]?.toString().trim() || "";
            const lastName = row[lastNameIndex]?.toString().trim() || "";
            
            // Skip fully empty rows
            if (!firstName && !lastName) continue;

            const fullName = `${firstName} ${lastName}`.trim();
            const email = emailIndex !== -1 ? row[emailIndex]?.toString().trim() || "" : "";
            
            parsedRows.push({
                rowNumber: i + 2,
                firstName,
                lastName,
                fullName,
                email,
                parentEmail: parentEmailIndex !== -1 ? row[parentEmailIndex]?.toString().trim() || "" : "",
                dobString: dobIndex !== -1 ? row[dobIndex]?.toString().trim() || "" : "",
                address: addressIndex !== -1 ? row[addressIndex]?.toString().trim() || "" : "",
                sameHouseholdAs: sameHouseholdIndex !== -1 ? row[sameHouseholdIndex]?.toString().trim() || "" : "",
            });

            if (email) batchEmails.add(email.toLowerCase());
            if (fullName) batchNames.add(fullName.toLowerCase());
        }

        const previews: RowPreview[] = [];
        const emailsSeen = new Map<string, number>(); // email -> first row number

        // Process each parsed row
        for (const pr of parsedRows) {
            const { rowNumber, firstName, lastName, fullName, email, parentEmail, dobString, address, sameHouseholdAs } = pr;

            const warnings: string[] = [];
            let status: RowStatus = "ready";
            let action = "";
            let existingParticipant: { id: number; name: string | null } | undefined;

            // Check: missing name
            if (!firstName && !lastName) {
                previews.push({
                    rowNumber,
                    data: { firstName, lastName, email, parentEmail, dob: dobString, address, sameHouseholdAs },
                    status: "error",
                    action: "Cannot import — missing both first and last name",
                    warnings: [],
                });
                continue;
            }

            // Check: DOB parsing
            let parsedDob: Date | undefined;
            if (dobString) {
                const d = new Date(dobString);
                if (isNaN(d.getTime())) {
                    warnings.push(`Could not parse date of birth: "${dobString}"`);
                } else {
                    parsedDob = d;
                }
            }

            // Check: student without parent email
            if (parsedDob) {
                const age = (Date.now() - parsedDob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
                if (age < 18 && !parentEmail && !sameHouseholdAs) {
                    warnings.push("Student (under 18) without a parent email or household reference");
                }
            }

            // Check: no email and no parent email and no household ref
            if (!email && !parentEmail && !sameHouseholdAs) {
                warnings.push("No email, parent email, or household ref — will attempt to match by name" + (parsedDob ? " and DOB" : " only (no DOB)"));
            }

            // Check: duplicate email within spreadsheet
            if (email) {
                const lowerEmail = email.toLowerCase();
                if (emailsSeen.has(lowerEmail)) {
                    warnings.push(`Duplicate email in spreadsheet (also on row ${emailsSeen.get(lowerEmail)})`);
                } else {
                    emailsSeen.set(lowerEmail, rowNumber);
                }
            }

            // Check "Same Household As" validity
            if (sameHouseholdAs) {
                let found = false;
                const searchLower = sameHouseholdAs.toLowerCase();

                // 1. Check if the ref exists in the current spreadsheet batch
                if (batchEmails.has(searchLower) || batchNames.has(searchLower)) {
                    found = true;
                    action += `Will link to household of "${sameHouseholdAs}" (from this spreadsheet). `;
                }
                
                // 2. Try to resolve the reference via DB
                if (!found && sameHouseholdAs.includes('@')) {
                    const byEmail = await prisma.participant.findUnique({
                        where: { email: sameHouseholdAs },
                        select: { id: true, name: true, householdId: true }
                    });
                    if (byEmail) {
                        found = true;
                        if (byEmail.householdId) {
                            action += `Will join household of "${byEmail.name || sameHouseholdAs}". `;
                        } else {
                            action += `Will create household with "${byEmail.name || sameHouseholdAs}". `;
                        }
                    }
                }
                if (!found) {
                    const byName = await prisma.participant.findFirst({
                        where: { name: { equals: sameHouseholdAs, mode: 'insensitive' } },
                        select: { id: true, name: true, householdId: true }
                    });
                    if (byName) {
                        found = true;
                        if (byName.householdId) {
                            action += `Will join household of "${byName.name}". `;
                        } else {
                            action += `Will create household with "${byName.name}". `;
                        }
                    }
                }
                if (!found) {
                    warnings.push(`Could not find participant "${sameHouseholdAs}" for household association`);
                }
            }

            // Check against existing DB records
            if (email) {
                const existing = await prisma.participant.findUnique({
                    where: { email },
                    select: { id: true, name: true, householdId: true },
                });
                if (existing) {
                    status = "update";
                    action += `Update existing participant: "${existing.name || 'Unnamed'}" (ID ${existing.id})`;
                    if (!existing.householdId) {
                        action += ". Will create household + membership";
                    }
                    existingParticipant = existing;
                } else {
                    action += "Create new participant with email + household + membership";
                }
            } else if (parentEmail) {
                const parent = await prisma.participant.findUnique({
                    where: { email: parentEmail },
                    select: { id: true, name: true, householdId: true },
                });

                if (parent) {
                    if (parent.householdId) {
                        const existingChild = await prisma.participant.findFirst({
                            where: { householdId: parent.householdId, name: fullName },
                            select: { id: true, name: true },
                        });
                        if (existingChild) {
                            status = "update";
                            action += `Update existing household member: "${existingChild.name}" under "${parent.name || parentEmail}"`;
                            existingParticipant = existingChild;
                        } else {
                            action += `Create new participant under "${parent.name || parentEmail}"'s household`;
                        }
                    } else {
                        action += `Create new participant; will create household for parent "${parent.name || parentEmail}"`;
                    }
                } else {
                    action += `Create new participant + placeholder parent for ${parentEmail}`;
                    warnings.push(`Parent email "${parentEmail}" not found — a placeholder parent will be created`);
                }
            } else if (!sameHouseholdAs) {
                // No email, no parent email, no household ref — match by name
                const matchQuery: any = { name: fullName };
                if (parsedDob) matchQuery.dob = parsedDob;

                const existing = await prisma.participant.findFirst({
                    where: matchQuery,
                    select: { id: true, name: true },
                });
                if (existing) {
                    status = "update";
                    action += `Update existing participant matched by name${parsedDob ? " and DOB" : ""}: "${existing.name}" (ID ${existing.id})`;
                    existingParticipant = existing;
                } else {
                    action += `Create new participant (matched by name${parsedDob ? " + DOB" : ""}, no email)`;
                }
            } else {
                // Has sameHouseholdAs but no email/parentEmail
                action += `Create new participant (no email)`;
            }

            // If there are warnings but status is still "ready" or "update", elevate to "warning"
            if (warnings.length > 0 && (status === "ready" || status === "update")) {
                status = "warning";
            }

            previews.push({
                rowNumber,
                data: { firstName, lastName, email, parentEmail, dob: dobString, address, sameHouseholdAs },
                status,
                action: action.trim(),
                warnings,
                existingParticipant,
            });
        }

        const summary = {
            ready: previews.filter(p => p.status === "ready").length,
            update: previews.filter(p => p.status === "update").length,
            warning: previews.filter(p => p.status === "warning").length,
            error: previews.filter(p => p.status === "error").length,
        };

        return NextResponse.json({
            columns: ["First Name", "Last Name", "Email", "Parent Email", "DOB", "Address", "Same Household As"],
            rows: previews,
            summary,
        });

    } catch (error) {
        console.error("Error in participant import preview:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
