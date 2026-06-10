import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import * as dotenv from 'dotenv'
import { seedBaseline } from '../src/lib/dev/seed-helpers'

dotenv.config()

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// The seed logic lives in src/lib/dev/seed-helpers.ts so the dashboard reset/macros share one
// source of truth with this CLI seed (DEV_DASHBOARD_DESIGN.md §4).
seedBaseline(prisma)
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
