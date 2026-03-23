import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import * as dotenv from 'dotenv'

dotenv.config()

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
    console.log("🌱 Seeding database with debug personas...\n")

    // ──────────────────────────────────────────────
    // 1. Create all 9 participant personas
    // ──────────────────────────────────────────────

    const boardMember = await prisma.participant.upsert({
        where: { email: 'boardmember@example.com' },
        update: { name: 'Board Member', phone: '555-555-0001', sysadmin: true, boardMember: true },
        create: {
            email: 'boardmember@example.com',
            name: 'Board Member',
            phone: '555-555-0001',
            sysadmin: true,
            boardMember: true,
        },
    })
    console.log(`✅ boardmember@example.com (id: ${boardMember.id}) — Sysadmin, Board Member`)

    const parentFamily = await prisma.participant.upsert({
        where: { email: 'parent.family@example.com' },
        update: { name: 'Parent Family', phone: '555-555-0002' },
        create: {
            email: 'parent.family@example.com',
            name: 'Parent Family',
            phone: '555-555-0002',
        },
    })
    console.log(`✅ parent.family@example.com (id: ${parentFamily.id}) — Household Lead`)

    const parent2Family = await prisma.participant.upsert({
        where: { email: 'parent2.family@example.com' },
        update: { name: 'Parent2 Family', phone: '555-555-0003' },
        create: {
            email: 'parent2.family@example.com',
            name: 'Parent2 Family',
            phone: '555-555-0003',
        },
    })
    console.log(`✅ parent2.family@example.com (id: ${parent2Family.id}) — Household Member`)

    // Child — DOB set to 10 years ago
    const childDob = new Date()
    childDob.setFullYear(childDob.getFullYear() - 10)

    const childFamily = await prisma.participant.upsert({
        where: { email: 'child.family@example.com' },
        update: { name: 'Child Family', dob: childDob },
        create: {
            email: 'child.family@example.com',
            name: 'Child Family',
            dob: childDob,
        },
    })
    console.log(`✅ child.family@example.com (id: ${childFamily.id}) — Minor (age 10)`)

    const parentFamily2 = await prisma.participant.upsert({
        where: { email: 'parent.family2@example.com' },
        update: { name: 'Parent Family2', phone: '555-555-0004' },
        create: {
            email: 'parent.family2@example.com',
            name: 'Parent Family2',
            phone: '555-555-0004',
        },
    })
    console.log(`✅ parent.family2@example.com (id: ${parentFamily2.id}) — Household Lead (Family2)`)

    const keyholder1 = await prisma.participant.upsert({
        where: { email: 'keyholder1@example.com' },
        update: { name: 'Keyholder One', phone: '555-555-0005', keyholder: true },
        create: {
            email: 'keyholder1@example.com',
            name: 'Keyholder One',
            phone: '555-555-0005',
            keyholder: true,
        },
    })
    console.log(`✅ keyholder1@example.com (id: ${keyholder1.id}) — Keyholder`)

    const keyholder2 = await prisma.participant.upsert({
        where: { email: 'keyholder2@example.com' },
        update: { name: 'Keyholder Two', phone: '555-555-0006', keyholder: true },
        create: {
            email: 'keyholder2@example.com',
            name: 'Keyholder Two',
            phone: '555-555-0006',
            keyholder: true,
        },
    })
    console.log(`✅ keyholder2@example.com (id: ${keyholder2.id}) — Keyholder`)

    const certifiedAdult = await prisma.participant.upsert({
        where: { email: 'certified.adult@example.com' },
        update: { name: 'Certified Adult', phone: '555-555-0007' },
        create: {
            email: 'certified.adult@example.com',
            name: 'Certified Adult',
            phone: '555-555-0007',
        },
    })
    console.log(`✅ certified.adult@example.com (id: ${certifiedAdult.id}) — Tool Certified`)

    const shopSteward = await prisma.participant.upsert({
        where: { email: 'shop.steward@example.com' },
        update: { name: 'Shop Steward', phone: '555-555-0008', shopSteward: true },
        create: {
            email: 'shop.steward@example.com',
            name: 'Shop Steward',
            phone: '555-555-0008',
            shopSteward: true,
        },
    })
    console.log(`✅ shop.steward@example.com (id: ${shopSteward.id}) — Shop Steward`)

    // ──────────────────────────────────────────────
    // 2. Households
    // ──────────────────────────────────────────────
    console.log("\n🏠 Setting up households...")

    // Household 1: "Family" — parent, parent2, child
    let household1 = await prisma.household.findFirst({ where: { name: 'Family' } })
    if (!household1) {
        household1 = await prisma.household.create({
            data: { name: 'Family', address: '123 Maker Lane' },
        })
    }

    // Assign members to household
    await prisma.participant.update({
        where: { id: parentFamily.id },
        data: { householdId: household1.id },
    })
    await prisma.participant.update({
        where: { id: parent2Family.id },
        data: { householdId: household1.id },
    })
    await prisma.participant.update({
        where: { id: childFamily.id },
        data: { householdId: household1.id },
    })

    // Make parentFamily the lead
    await prisma.householdLead.upsert({
        where: {
            householdId_participantId: {
                householdId: household1.id,
                participantId: parentFamily.id,
            },
        },
        update: {},
        create: {
            householdId: household1.id,
            participantId: parentFamily.id,
        },
    })
    console.log(`✅ Household "Family" (id: ${household1.id}) — parent, parent2, child`)

    // Household 2: "Family2" — single parent
    let household2 = await prisma.household.findFirst({ where: { name: 'Family2' } })
    if (!household2) {
        household2 = await prisma.household.create({
            data: { name: 'Family2', address: '456 Workshop Drive' },
        })
    }

    await prisma.participant.update({
        where: { id: parentFamily2.id },
        data: { householdId: household2.id },
    })

    await prisma.householdLead.upsert({
        where: {
            householdId_participantId: {
                householdId: household2.id,
                participantId: parentFamily2.id,
            },
        },
        update: {},
        create: {
            householdId: household2.id,
            participantId: parentFamily2.id,
        },
    })
    console.log(`✅ Household "Family2" (id: ${household2.id}) — single parent`)

    // ──────────────────────────────────────────────
    // 3. Tools & Certifications
    // ──────────────────────────────────────────────
    console.log("\n🔧 Setting up tools and certifications...")

    const tableSaw = await prisma.tool.upsert({
        where: { id: 1 },
        update: { name: 'Table Saw' },
        create: { name: 'Table Saw', safetyGuide: 'https://example.com/table-saw-safety' },
    })

    const drillPress = await prisma.tool.upsert({
        where: { id: 2 },
        update: { name: 'Drill Press' },
        create: { name: 'Drill Press', safetyGuide: 'https://example.com/drill-press-safety' },
    })

    // Give certified.adult CERTIFIED level on both tools
    await prisma.toolStatus.upsert({
        where: {
            userId_toolId: {
                userId: certifiedAdult.id,
                toolId: tableSaw.id,
            },
        },
        update: { level: 'CERTIFIED' },
        create: {
            userId: certifiedAdult.id,
            toolId: tableSaw.id,
            level: 'CERTIFIED',
        },
    })

    await prisma.toolStatus.upsert({
        where: {
            userId_toolId: {
                userId: certifiedAdult.id,
                toolId: drillPress.id,
            },
        },
        update: { level: 'CERTIFIED' },
        create: {
            userId: certifiedAdult.id,
            toolId: drillPress.id,
            level: 'CERTIFIED',
        },
    })
    console.log(`✅ Tools: Table Saw (id: ${tableSaw.id}), Drill Press (id: ${drillPress.id})`)
    console.log(`✅ certified.adult has CERTIFIED on both tools`)

    // ──────────────────────────────────────────────
    // 4. Sample Program
    // ──────────────────────────────────────────────
    console.log("\n📋 Setting up sample program...")

    let program = await prisma.program.findFirst({ where: { name: 'Woodworking 101' } })
    if (!program) {
        program = await prisma.program.create({
            data: {
                name: 'Woodworking 101',
                leadMentorId: boardMember.id,
                begin: new Date(),
                end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
                phase: 'UPCOMING',
                enrollmentStatus: 'OPEN',
                memberOnly: false,
                minAge: 8,
                maxParticipants: 20,
            },
        })
    }
    console.log(`✅ Program "Woodworking 101" (id: ${program.id})`)

    // ──────────────────────────────────────────────
    // Done
    // ──────────────────────────────────────────────
    console.log("\n🎉 Seed complete! All 9 debug personas are ready.\n")
    console.log("Login with any of the following emails in dev mode:")
    console.log("  boardmember@example.com      — Board Member / Sysadmin")
    console.log("  parent.family@example.com     — Household Lead (Family)")
    console.log("  parent2.family@example.com    — Household Member (Family)")
    console.log("  child.family@example.com      — Minor (Family)")
    console.log("  parent.family2@example.com    — Household Lead (Family2)")
    console.log("  keyholder1@example.com        — Keyholder")
    console.log("  keyholder2@example.com        — Keyholder")
    console.log("  certified.adult@example.com   — Tool Certified")
    console.log("  shop.steward@example.com      — Shop Steward")
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
