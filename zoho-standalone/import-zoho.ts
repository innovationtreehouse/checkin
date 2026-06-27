import { PrismaClient } from "./generated/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseZoho, buildImport, applyImport, renderReport } from "./zoho-import";

/**
 * One-time CLI to import the legacy Zoho membership export into checkin.
 *
 *   npx tsx scripts/import-zoho.ts --actor <participantId> [--dir <path>] [--commit]
 *
 * Defaults to a DRY RUN (no writes) and prints the report. Pass --commit to write.
 * Bootstraps Prisma exactly like prisma/seed.ts (PrismaPg adapter, DATABASE_URL).
 */

dotenv.config();

function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (flag: string) => process.argv.includes(flag);

async function main() {
    const dir = arg("--dir") ?? path.join(os.homedir(), "Software", "Zoho");
    const actorId = Number(arg("--actor"));
    const commit = hasFlag("--commit");

    if (!Number.isInteger(actorId) || actorId <= 0) {
        throw new Error("--actor <participantId> is required (a real sysadmin Participant id, for the audit trail).");
    }

    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const files = parseZoho({
        list: read("ZohoMemberList.json"),
        families: read("ZohoMemberFamilies.json"),
        inputs: read("ZohoMemberInputs.json"),
    });

    const built = buildImport(files, new Date());
    console.log(renderReport(built.report));

    if (!commit) {
        console.log("\nDRY RUN — no changes written. Re-run with --commit to apply.");
        return;
    }

    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is not set — point it at the target database before --commit.");
    }
    // connectionTimeoutMillis: pg defaults to infinite, so an unreachable DB hangs forever. Fail fast.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });
    try {
        // Confirm the audit actor exists before writing anything.
        const actor = await prisma.participant.findUnique({ where: { id: actorId } });
        if (!actor) throw new Error(`--actor ${actorId} is not an existing Participant.`);

        const result = await prisma.$transaction((tx) => applyImport(tx, built, actorId), {
            timeout: 120_000,
        });
        console.log("\n✅ Committed:", JSON.stringify(result, null, 2));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
