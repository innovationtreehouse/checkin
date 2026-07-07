/**
 * @jest-environment node
 */
/**
 * Unit tests for the staleness framework's pure/edge logic (prisma + email mocked,
 * no DB): the escalation-bucket math (activeThreshold), the ledger dedup guard,
 * and the digest assembly. The concrete types' DB queries are covered by the
 * integration test (cronStaleness.integration.test.ts).
 */
import { Prisma } from '@/generated/prisma/client';
import { activeThreshold, runStalenessNotifications, sendStalenessDigest, type StaleType } from '@/lib/staleness/registry';

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: { notificationLedger: { create: jest.fn() } },
}));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/emailRecipients', () => ({ emailAdmins: jest.fn().mockResolvedValue(undefined) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require('@/lib/prisma').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendEmail } = require('@/lib/email');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { emailAdmins } = require('@/lib/emailRecipients');

const DAY = 86400000;
const P2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

beforeEach(() => jest.clearAllMocks());

describe('activeThreshold', () => {
    const now = new Date('2026-07-06T00:00:00Z');

    it('returns 0 for a null dueAt (no schedule, stale now)', () => {
        expect(activeThreshold([0], null, now)).toBe(0);
        expect(activeThreshold([30, 7, 0], null, now)).toBe(0);
    });

    it('returns null before the widest window opens', () => {
        const due = new Date(now.getTime() + 40 * DAY);
        expect(activeThreshold([30, 7, 0], due, now)).toBeNull();
    });

    it('picks the SMALLEST entered bucket (a skip past 30 straight to 5 fires 7, not 30)', () => {
        const due = new Date(now.getTime() + 5 * DAY); // daysUntil 5 → entered {30,7}, min 7
        expect(activeThreshold([30, 7, 0], due, now)).toBe(7);
    });

    it('fires 30 exactly when it first enters the 30-day window', () => {
        const due = new Date(now.getTime() + 30 * DAY);
        expect(activeThreshold([30, 7, 0], due, now)).toBe(30);
    });

    it('an overdue item collapses to the smallest threshold', () => {
        const due = new Date(now.getTime() - 3 * DAY);
        expect(activeThreshold([30, 7, 0], due, now)).toBe(0); // 0 present → lapsed bucket
        expect(activeThreshold([30, 7], due, now)).toBe(7); // no 0 bucket → smallest is 7
    });
});

// A fake type so the dedup/runner logic is exercised without any DB query in find().
function fakeType(over: Partial<StaleType> & { recipients?: string[] } = {}): StaleType {
    const recipients = over.recipients ?? ['lead@ex.com'];
    return {
        key: over.key ?? 'FAKE',
        label: over.label ?? 'Fakes',
        thresholds: over.thresholds ?? [30, 7, 0],
        find: over.find ?? (async () => [{
            subjectKey: 'fake:1',
            dueAt: new Date(Date.now() + 5 * DAY),
            recipients,
            digestLine: 'Household X — something',
            email: (t: number) => ({ subject: `s${t}`, html: `<p>h${t}</p>` }),
        }]),
    };
}

describe('runStalenessNotifications dedup', () => {
    it('claims the ledger then sends; a P2002 (already sent / concurrent run) skips without re-sending', async () => {
        prisma.notificationLedger.create.mockResolvedValueOnce({}); // first run wins the insert
        const first = await runStalenessNotifications(new Date(), [fakeType()]);
        expect(first.FAKE).toEqual({ sent: 1, skipped: 0 });
        expect(prisma.notificationLedger.create).toHaveBeenCalledWith({
            data: { type: 'FAKE', subjectKey: 'fake:1', threshold: 7 },
        });
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(sendEmail).toHaveBeenCalledWith('lead@ex.com', 's7', '<p>h7</p>');

        jest.clearAllMocks();
        prisma.notificationLedger.create.mockRejectedValueOnce(P2002); // second run loses the insert
        const second = await runStalenessNotifications(new Date(), [fakeType()]);
        expect(second.FAKE).toEqual({ sent: 0, skipped: 1 });
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('an item with no recipients is skipped and writes no ledger row (digest is the backstop)', async () => {
        const t = fakeType({ recipients: [] });
        const res = await runStalenessNotifications(new Date(), [t]);
        expect(res.FAKE).toEqual({ sent: 0, skipped: 1 });
        expect(prisma.notificationLedger.create).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('an item not yet in any window is skipped silently (no send, no ledger)', async () => {
        const t = fakeType({
            find: async () => [{
                subjectKey: 'fake:far',
                dueAt: new Date(Date.now() + 40 * DAY), // outside the 30-day window
                recipients: ['lead@ex.com'],
                digestLine: 'x',
                email: () => ({ subject: 's', html: 'h' }),
            }],
        });
        const res = await runStalenessNotifications(new Date(), [t]);
        expect(res.FAKE).toEqual({ sent: 0, skipped: 0 });
        expect(prisma.notificationLedger.create).not.toHaveBeenCalled();
    });

    it('a non-P2002 error from the ledger create is not swallowed', async () => {
        prisma.notificationLedger.create.mockRejectedValueOnce(new Error('db down'));
        await expect(runStalenessNotifications(new Date(), [fakeType()])).rejects.toThrow('db down');
    });
});

describe('sendStalenessDigest', () => {
    it('lists only in-window items, grouped by type, and emails the admin list', async () => {
        const res = await sendStalenessDigest(new Date(), [fakeType()]);
        expect(res).toEqual({ sent: true, counts: { FAKE: 1 } });
        expect(emailAdmins).toHaveBeenCalledTimes(1);
        const [, html] = emailAdmins.mock.calls[0];
        expect(html).toContain('Fakes');
        expect(html).toContain('Household X — something');
    });

    it('sends nothing when nothing is currently stale', async () => {
        const empty = fakeType({ find: async () => [] });
        const res = await sendStalenessDigest(new Date(), [empty]);
        expect(res).toEqual({ sent: false, counts: { FAKE: 0 } });
        expect(emailAdmins).not.toHaveBeenCalled();
    });

    it('escapes user-controlled digest text', async () => {
        const evil = fakeType({
            find: async () => [{
                subjectKey: 'x', dueAt: null, recipients: [],
                digestLine: '<img src=x onerror=alert(1)>', email: () => ({ subject: '', html: '' }),
            }],
        });
        await sendStalenessDigest(new Date(), [evil]);
        const [, html] = emailAdmins.mock.calls[0];
        expect(html).toContain('&lt;img');
        expect(html).not.toContain('<img src=x');
    });
});
