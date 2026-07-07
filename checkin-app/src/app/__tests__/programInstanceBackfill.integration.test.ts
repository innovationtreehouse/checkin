import fs from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';

/**
 * Phase-1 backfill (MB) of PROGRAM_INSTANCE_RESTRUCTURE.md against a populated
 * schema. The migration itself no-ops at global setup (empty DB), so this test
 * seeds real Program/Event rows, then runs the migration's OWN backfill SQL
 * (extracted verbatim between its markers — not a reimplementation) and asserts:
 *   - one ProgramInstance per program, id-aliased (instance.id === program.id)
 *   - every offering column copied, narrowing overrides left NULL
 *   - program-bound events linked, program-less events untouched
 *   - the id sequence bumped past the aliased ids (no collision on a new insert)
 *   - the whole thing is idempotent (running it twice changes nothing)
 */

const MIGRATION_SQL = path.join(
    __dirname,
    '../../../prisma/migrations/20260708040000_program_instances_phase1/migration.sql',
);

/** Pull the statements between the BACKFILL markers — the exact SQL the deploy runs. */
function backfillStatements(): string[] {
    const raw = fs.readFileSync(MIGRATION_SQL, 'utf8');
    // Drop the remainder of the START marker line (everything up to its newline)
    // so any trailing note on that line can never leak into a SQL statement.
    const afterStart = raw.split('-- >>> BACKFILL START')[1];
    const block = afterStart.slice(afterStart.indexOf('\n') + 1).split('-- >>> BACKFILL END')[0];
    return block
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);
}

async function runBackfill(): Promise<void> {
    for (const stmt of backfillStatements()) {
        await prisma.$executeRawUnsafe(stmt);
    }
}

describe('ProgramInstance phase-1 backfill (MB)', () => {
    let householdId: number;
    let leadId: number;
    let progLegacyId: number; // pre-#930 two-variant program
    let progSingleId: number; // #930 single-pool program
    let boundEventId: number;
    let looseEventId: number; // program-less event

    beforeAll(async () => {
        const household = await prisma.household.create({ data: { name: 'Backfill Test HH' } });
        householdId = household.id;
        const lead = await prisma.person.create({
            data: { name: 'Backfill Lead', email: `backfill.lead.${Date.now()}@example.com`, householdId },
        });
        leadId = lead.id;

        const legacy = await prisma.program.create({
            data: {
                name: 'Backfill Legacy Program',
                leadMentorId: leadId,
                startAt: new Date('2026-09-01'),
                endAt: new Date('2026-12-01'),
                phase: 'RUNNING',
                enrollmentStatus: 'OPEN',
                orgMemberOnly: true,
                minAge: 10,
                maxAge: 14,
                maxParticipants: 12,
                leadMentorNotificationSettings: { digest: 'weekly' },
                shopifyProductId: 'prod_legacy',
                shopifyOrgMemberVariantId: 'var_org_legacy',
                shopifyNonOrgMemberVariantId: 'var_nonorg_legacy',
            },
        });
        progLegacyId = legacy.id;

        const single = await prisma.program.create({
            data: {
                name: 'Backfill Single Program',
                startAt: new Date('2027-01-01'),
                endAt: new Date('2027-03-01'),
                phase: 'UPCOMING',
                enrollmentStatus: 'CLOSED',
                minAge: 8,
                maxParticipants: 20,
                shopifyProductId: 'prod_single',
                shopifyVariantId: 'var_single',
            },
        });
        progSingleId = single.id;

        const boundEvent = await prisma.event.create({
            data: { name: 'Backfill Bound Event', programId: progLegacyId, startAt: new Date(), endAt: new Date() },
        });
        boundEventId = boundEvent.id;
        const looseEvent = await prisma.event.create({
            data: { name: 'Backfill Loose Event', programId: null, startAt: new Date(), endAt: new Date() },
        });
        looseEventId = looseEvent.id;

        await runBackfill();
    });

    afterAll(async () => {
        // instance.programId is ON DELETE RESTRICT, so instances go before programs;
        // events' instanceId is ON DELETE SET NULL so instance deletes don't block.
        await prisma.event.deleteMany({ where: { id: { in: [boundEventId, looseEventId] } } });
        await prisma.programInstance.deleteMany({ where: { programId: { in: [progLegacyId, progSingleId] } } });
        await prisma.program.deleteMany({ where: { id: { in: [progLegacyId, progSingleId] } } });
        await prisma.person.deleteMany({ where: { id: leadId } });
        await prisma.household.deleteMany({ where: { id: householdId } });
    });

    it('creates exactly one id-aliased instance per program', async () => {
        const legacyInstances = await prisma.programInstance.findMany({ where: { programId: progLegacyId } });
        const singleInstances = await prisma.programInstance.findMany({ where: { programId: progSingleId } });
        expect(legacyInstances).toHaveLength(1);
        expect(singleInstances).toHaveLength(1);
        // id-alias: instance.id === program.id (what makes the later FK repoint a pure rename)
        expect(legacyInstances[0].id).toBe(progLegacyId);
        expect(singleInstances[0].id).toBe(progSingleId);
    });

    it('copies every offering column and leaves narrowing overrides NULL', async () => {
        const inst = await prisma.programInstance.findUniqueOrThrow({ where: { id: progLegacyId } });
        expect(inst.name).toBe('Backfill Legacy Program');
        expect(inst.leadMentorId).toBe(leadId);
        expect(inst.phase).toBe('RUNNING');
        expect(inst.enrollmentStatus).toBe('OPEN');
        expect(inst.maxParticipants).toBe(12);
        expect(inst.startAt?.toISOString()).toBe(new Date('2026-09-01').toISOString());
        expect(inst.leadMentorNotificationSettings).toEqual({ digest: 'weekly' });
        // legacy two-variant pair mirrored (the #930 deviation: no shopifyMemberDiscountId exists)
        expect(inst.shopifyProductId).toBe('prod_legacy');
        expect(inst.shopifyOrgMemberVariantId).toBe('var_org_legacy');
        expect(inst.shopifyNonOrgMemberVariantId).toBe('var_nonorg_legacy');
        expect(inst.shopifyVariantId).toBeNull();
        // narrowing overrides start NULL = inherit the parent definition
        expect(inst.minAge).toBeNull();
        expect(inst.maxAge).toBeNull();
        expect(inst.orgMemberOnly).toBeNull();

        const single = await prisma.programInstance.findUniqueOrThrow({ where: { id: progSingleId } });
        expect(single.shopifyVariantId).toBe('var_single');
        expect(single.shopifyOrgMemberVariantId).toBeNull();
        expect(single.leadMentorId).toBeNull();
    });

    it('links program-bound events and leaves program-less events untouched', async () => {
        const bound = await prisma.event.findUniqueOrThrow({ where: { id: boundEventId } });
        const loose = await prisma.event.findUniqueOrThrow({ where: { id: looseEventId } });
        expect(bound.instanceId).toBe(progLegacyId); // === programId via id-alias
        expect(loose.instanceId).toBeNull();
    });

    it('bumps the id sequence past the aliased ids (new insert does not collide)', async () => {
        const created = await prisma.programInstance.create({
            data: { programId: progSingleId, name: 'Post-backfill Instance' },
        });
        try {
            expect(created.id).toBeGreaterThan(Math.max(progLegacyId, progSingleId));
        } finally {
            await prisma.programInstance.delete({ where: { id: created.id } });
        }
    });

    it('is idempotent — a second run adds nothing and mutates nothing', async () => {
        const before = await prisma.programInstance.count({
            where: { programId: { in: [progLegacyId, progSingleId] } },
        });
        await runBackfill();
        const after = await prisma.programInstance.count({
            where: { programId: { in: [progLegacyId, progSingleId] } },
        });
        expect(after).toBe(before);
        // event link unchanged, not doubled or cleared
        const bound = await prisma.event.findUniqueOrThrow({ where: { id: boundEventId } });
        expect(bound.instanceId).toBe(progLegacyId);
    });
});
