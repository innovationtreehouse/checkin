/**
 * @jest-environment node
 */
/**
 * Full-cron integration for the staleness notifications framework
 * (docs/designs/STALENESS_NOTIFICATIONS.md), one run per output:
 *   - GET /api/cron/staleness-notifications: household-direct emails go to the
 *     right (working) recipients, the NotificationLedger is written, and a re-run
 *     re-sends nothing.
 *   - GET /api/cron/staleness-digest: the board/ops admin list gets one digest
 *     that lists the currently-stale items.
 *
 * sendEmail is mocked (the app's email boundary); everything else is real DB.
 */
import { GET as notificationsGET } from '@/app/api/cron/staleness-notifications/route';
import { GET as digestGET } from '@/app/api/cron/staleness-digest/route';
import prisma from '@/lib/prisma';
import { sendEmail } from '@/lib/email';

jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'staleness-int';
const DAY = 86400000;

function cronReq(path: string) {
    process.env.CRON_SECRET = 'test-secret';
    return new Request(`http://localhost:4000/api/cron/${path}`, {
        method: 'GET',
        headers: { authorization: 'Bearer test-secret' },
    });
}

const sentTo = (email: string) =>
    (sendEmail as jest.Mock).mock.calls.filter((c) => c[0] === email);

describe('Staleness cron integration', () => {
    let householdId = 0;
    let workingLeadEmail = '';
    let brokenLeadEmail = '';
    let adminEmail = '';
    let taName = '';

    beforeAll(async () => {
        await cleanup();

        const hh = await prisma.household.create({ data: { name: `Stale HH ${TAG}` } });
        householdId = hh.id;

        // Working lead (gets the household-direct notices) + a broken-email lead
        // (excluded as a recipient; their broken address is itself a stale item).
        workingLeadEmail = `working-${TAG}@ex.com`;
        brokenLeadEmail = `broken-${TAG}@ex.com`;
        const workingLead = await prisma.person.create({
            data: { name: 'Working Lead', email: workingLeadEmail, householdId, isHouseholdLead: true },
        });
        await prisma.person.create({
            data: {
                name: 'Broken Lead', email: brokenLeadEmail, householdId, isHouseholdLead: true,
                emailUndeliverableAt: new Date(Date.now() - 2 * DAY),
            },
        });

        // A board member (its own household) → the digest admin recipient.
        adminEmail = `admin-${TAG}@ex.com`;
        await prisma.person.create({
            data: { name: 'Boardie', email: adminEmail, isBoardMember: true, household: { create: { name: `Admin HH ${TAG}` } } },
        });

        // An approved trusted adult expiring in 10 days → inside the [30,7] window.
        taName = `Grandma ${TAG}`;
        const ta = await prisma.trustedAdult.create({
            data: { householdId, trustedAdultName: taName, trustedAdultEmail: 'g@ex.com', familyContext: 'ctx', disclosedById: workingLead.id },
        });
        await prisma.trustedAdultReview.create({
            data: {
                householdId, trustedAdultId: ta.id, kind: 'INITIAL', status: 'APPROVED',
                reviewBy: new Date(Date.now() + 10 * DAY),
            },
        });
    });

    afterAll(async () => {
        await cleanup();
        await prisma.$disconnect();
    });

    async function cleanup() {
        await prisma.notificationLedger.deleteMany(); // new table, only these tests use it
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.trustedAdultReview.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.trustedAdult.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
    }

    it('household pass: notifies the working lead, writes the ledger, and a re-run re-sends nothing', async () => {
        const res = await notificationsGET(cronReq('staleness-notifications'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);

        // Working lead got BOTH the broken-email heads-up and the trusted-adult expiry.
        const calls = sentTo(workingLeadEmail);
        expect(calls.some((c) => /bouncing/i.test(c[1]))).toBe(true);
        expect(calls.some((c) => /trusted adult/i.test(c[1]))).toBe(true);
        // The broken address is never emailed.
        expect(sentTo(brokenLeadEmail)).toHaveLength(0);

        // Ledger recorded my household's items.
        const brokenLedger = await prisma.notificationLedger.findMany({ where: { type: 'BROKEN_EMAIL' } });
        const taLedger = await prisma.notificationLedger.findMany({ where: { type: 'TRUSTED_ADULT', threshold: 30 } });
        expect(brokenLedger.length).toBeGreaterThanOrEqual(1);
        expect(taLedger.length).toBeGreaterThanOrEqual(1);

        // Re-run: the ledger makes it a no-op for the working lead.
        (sendEmail as jest.Mock).mockClear();
        const res2 = await notificationsGET(cronReq('staleness-notifications'));
        expect(res2.status).toBe(200);
        expect(sentTo(workingLeadEmail)).toHaveLength(0);
    });

    it('weekly digest: emails the admin list one grouped digest of currently-stale items', async () => {
        (sendEmail as jest.Mock).mockClear();
        const res = await digestGET(cronReq('staleness-digest'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.sent).toBe(true);

        const adminCalls = sentTo(adminEmail);
        expect(adminCalls).toHaveLength(1);
        const [, subject, html] = adminCalls[0];
        expect(subject).toBe('Weekly staleness digest');
        expect(html).toContain('Trusted adults');
        expect(html).toContain(taName);
        expect(html).toContain('Broken email addresses');
        expect(html).toContain(brokenLeadEmail);
    });
});
