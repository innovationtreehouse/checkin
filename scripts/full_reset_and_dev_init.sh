#!/bin/bash
# full_reset_and_dev_init.sh
# Wipes the entire database, re-runs all migrations, and seeds dev personas.
# Usage: bash scripts/full_reset_and_dev_init.sh

set -e
cd "$(dirname "$0")/.."

echo "=== Full Database Reset ==="
echo "This will DROP all tables and re-run migrations."
echo ""

npx prisma migrate reset --force

echo ""
echo "=== Seeding Dev Personas ==="

node -e "
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
    // ── Households ──
    const h1 = await pool.query(
        \`INSERT INTO \"Household\" (name, address) VALUES (\\\$1, \\\$2) RETURNING id\`,
        ['Smith Household', '100 Main St']
    );
    const householdId = h1.rows[0].id;

    const h2 = await pool.query(
        \`INSERT INTO \"Household\" (name, address) VALUES (\\\$1, \\\$2) RETURNING id\`,
        ['Johnson Household', '200 Oak Ave']
    );
    const household2Id = h2.rows[0].id;

    // ── HOUSEHOLD Memberships ──
    await pool.query(
        \`INSERT INTO \"Membership\" (\"householdId\", type, active) VALUES (\\\$1, 'HOUSEHOLD', true)\`,
        [householdId]
    );
    await pool.query(
        \`INSERT INTO \"Membership\" (\"householdId\", type, active) VALUES (\\\$1, 'HOUSEHOLD', true)\`,
        [household2Id]
    );

    // ── Participants ──
    const personas = [
        { name: 'Alice Admin',     email: 'alice.admin@example.com',      sysadmin: true,  boardMember: true,  keyholder: true,  shopSteward: false, householdId: householdId, dob: '1985-03-15' },
        { name: 'Bob Board',       email: 'bob.board@example.com',        sysadmin: false, boardMember: true,  keyholder: false, shopSteward: false, householdId: null,        dob: '1990-06-22' },
        { name: 'Carol Keyholder', email: 'carol.keyholder@example.com',  sysadmin: false, boardMember: false, keyholder: true,  shopSteward: true,  householdId: household2Id, dob: '1988-11-05' },
        { name: 'Dave Member',     email: 'dave.member@example.com',      sysadmin: false, boardMember: false, keyholder: false, shopSteward: false, householdId: householdId, dob: '1992-01-30' },
        { name: 'Eve Guest',       email: 'eve.guest@example.com',        sysadmin: false, boardMember: false, keyholder: false, shopSteward: false, householdId: null,        dob: '1995-09-12' },
        { name: 'Frank Steward',   email: 'frank.steward@example.com',    sysadmin: false, boardMember: false, keyholder: true,  shopSteward: true,  householdId: household2Id, dob: '1987-04-18' },
        { name: 'Grace Minor',     email: null,                           sysadmin: false, boardMember: false, keyholder: false, shopSteward: false, householdId: householdId, dob: '2015-07-25' },
        { name: 'Henry Teen',      email: 'henry.teen@example.com',       sysadmin: false, boardMember: false, keyholder: false, shopSteward: false, householdId: householdId, dob: '2010-12-03' },
    ];

    for (const p of personas) {
        const result = await pool.query(
            \`INSERT INTO \"Participant\" (name, email, sysadmin, \"boardMember\", keyholder, \"shopSteward\", \"householdId\", dob)
             VALUES (\\\$1, \\\$2, \\\$3, \\\$4, \\\$5, \\\$6, \\\$7, \\\$8) RETURNING id\`,
            [p.name, p.email, p.sysadmin, p.boardMember, p.keyholder, p.shopSteward, p.householdId, p.dob ? new Date(p.dob) : null]
        );
        console.log('  ✓ ' + p.name + (p.email ? ' (' + p.email + ')' : ' (no email — minor)'));

        // Make household leads for adults with households
        if (p.householdId && p.dob) {
            const age = (Date.now() - new Date(p.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
            if (age >= 18) {
                await pool.query(
                    \`INSERT INTO \"HouseholdLead\" (\"householdId\", \"participantId\") VALUES (\\\$1, \\\$2)
                     ON CONFLICT DO NOTHING\`,
                    [p.householdId, result.rows[0].id]
                );
            }
        }
    }

    // ── Sample Tools ──
    const tools = ['Table Saw', 'Band Saw', 'Drill Press', 'Lathe', 'CNC Router'];
    const toolIds = [];
    for (const toolName of tools) {
        const r = await pool.query(
            \`INSERT INTO \"Tool\" (name) VALUES (\\\$1) RETURNING id\`,
            [toolName]
        );
        toolIds.push(r.rows[0].id);
    }
    console.log('  ✓ Created ' + toolIds.length + ' sample tools');

    // Give Carol and Frank some certifications
    const carolRes = await pool.query(\`SELECT id FROM \"Participant\" WHERE email = 'carol.keyholder@example.com'\`);
    const frankRes = await pool.query(\`SELECT id FROM \"Participant\" WHERE email = 'frank.steward@example.com'\`);

    if (carolRes.rows.length > 0) {
        await pool.query(\`INSERT INTO \"ToolStatus\" (\"userId\", \"toolId\", level) VALUES (\\\$1, \\\$2, 'CERTIFIED')\`, [carolRes.rows[0].id, toolIds[0]]);
        await pool.query(\`INSERT INTO \"ToolStatus\" (\"userId\", \"toolId\", level) VALUES (\\\$1, \\\$2, 'BASIC')\`, [carolRes.rows[0].id, toolIds[1]]);
    }
    if (frankRes.rows.length > 0) {
        await pool.query(\`INSERT INTO \"ToolStatus\" (\"userId\", \"toolId\", level) VALUES (\\\$1, \\\$2, 'CERTIFIED')\`, [frankRes.rows[0].id, toolIds[2]]);
    }
    console.log('  ✓ Added sample tool certifications');

    console.log('');
    console.log('=== Done! Dev personas ready. ===');
    console.log('Accounts: alice.admin, bob.board, carol.keyholder, dave.member,');
    console.log('          eve.guest, frank.steward, grace.minor (no email), henry.teen');
}

seed().catch(e => { console.error(e); process.exit(1); }).finally(() => pool.end());
"

echo ""
echo "You can now start the dev server: npm run dev"
