import { PrismaClient } from './src/generated/prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const pool = new Pool({ connectionString: `${process.env.DATABASE_URL}` })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

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
