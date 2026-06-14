import { PrismaClient } from '@/generated/prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = `${process.env.DATABASE_URL}`
// Tests default to a single connection so suites don't exhaust a small CI
// Postgres. TEST_DB_POOL_MAX lets a suite opt into a larger pool: the scan
// concurrency suite needs >= 2 so two scan transactions run on separate
// connections — that's the only way the per-participant advisory lock (not the
// $transaction wrapping) is what serializes them, matching production (pool 10).
const poolMax = process.env.NODE_ENV === 'test'
    ? Number(process.env.TEST_DB_POOL_MAX ?? 1)
    : 10
const pool = new Pool({ connectionString, max: poolMax })
const adapter = new PrismaPg(pool)

const prismaClientSingleton = () => {
    return new PrismaClient({ adapter })
}

declare const globalThis: {
    prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
