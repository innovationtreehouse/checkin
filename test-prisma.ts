import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
    console.log("Querying information_schema.columns...");
    const result = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'Participant';
    `);
    console.log(result);
}

main().catch(console.error).finally(() => prisma.$disconnect());
