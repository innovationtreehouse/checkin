/**
 * @jest-environment node
 */
/**
 * Integration tests for the DB-backed loggers in lib/logger.ts. They use the
 * real prisma client (no mock), so this is an integration test against a live
 * Postgres — run via `npm run test:integration`.
 *
 * Coverage:
 *   - logIntegrationError writes one IntegrationErrorLog row (source/message/context)
 *   - the 90-day IntegrationErrorLog purge deletes >90d rows and KEEPS <90d rows
 *   - the 30-day ErrorLog purge (logBackendError) deletes >30d rows and KEEPS <30d
 *
 * Purge boundaries are time-dependent: rows are seeded with EXPLICIT createdAt
 * timestamps well clear of the cutoff, and survivors are asserted by id (not by
 * count) because the purge is global and other rows may exist.
 */
import prisma from '@/lib/prisma';
import { logIntegrationError, logBackendError } from '@/lib/logger';

const TAG = 'logger-integration-test';
const DAY = 24 * 60 * 60 * 1000;

describe('logger DB persistence + TTL purge', () => {
    afterAll(async () => {
        await prisma.integrationErrorLog.deleteMany({ where: { source: { contains: TAG } } });
        await prisma.errorLog.deleteMany({ where: { route: { contains: TAG } } });
    });

    it('writes one IntegrationErrorLog row with source/message/context populated', async () => {
        const source = `${TAG}-write`;
        await logIntegrationError(source, new Error('kaboom'), { programName: 'X', ids: [7, 9] });

        const rows = await prisma.integrationErrorLog.findMany({ where: { source } });
        expect(rows).toHaveLength(1);
        expect(rows[0].message).toBe('kaboom');
        expect(rows[0].context).toEqual({ programName: 'X', ids: [7, 9] });
    });

    it('purges IntegrationErrorLog rows older than 90 days and keeps newer ones', async () => {
        const now = Date.now();
        const old = await prisma.integrationErrorLog.create({
            data: { source: `${TAG}-old`, message: 'old', timestamp: new Date(now - 100 * DAY) },
        });
        const recent = await prisma.integrationErrorLog.create({
            data: { source: `${TAG}-recent`, message: 'recent', timestamp: new Date(now - 10 * DAY) },
        });

        // Any write triggers the 90-day purge.
        await logIntegrationError(`${TAG}-trigger`, 'trigger');

        expect(await prisma.integrationErrorLog.findUnique({ where: { id: old.id } })).toBeNull();
        expect(await prisma.integrationErrorLog.findUnique({ where: { id: recent.id } })).not.toBeNull();
    });

    it('purges ErrorLog rows older than 30 days and keeps newer ones', async () => {
        const now = Date.now();
        const old = await prisma.errorLog.create({
            data: { message: 'old', route: `${TAG}-old`, timestamp: new Date(now - 40 * DAY) },
        });
        const recent = await prisma.errorLog.create({
            data: { message: 'recent', route: `${TAG}-recent`, timestamp: new Date(now - 5 * DAY) },
        });

        // Mock console.error to prevent jest-fail-on-console from failing the test
        // since logBackendError now calls console.error explicitly.
        const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        // logBackendError writes the new row, then runs the 30-day purge.
        await logBackendError(new Error('trigger'), `${TAG}-trigger`);
        mockConsoleError.mockRestore();

        expect(await prisma.errorLog.findUnique({ where: { id: old.id } })).toBeNull();
        expect(await prisma.errorLog.findUnique({ where: { id: recent.id } })).not.toBeNull();
    });
});
