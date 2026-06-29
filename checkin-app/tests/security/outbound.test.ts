/**
 * Unit tests for the OUTBOUND gateway — the only legal path for data leaving
 * the app to a third party (Shopify, email, external webhooks).
 *
 * Mirrors tests/security/stripper.test.ts conventions: pure unit tests, no DB,
 * no auth, no HTTP. Synthetic payload bags run through `outboundCall`, and we
 * assert what the `send` callback actually receives on the wire.
 *
 * Unlike the inbound stripper there is NO caller / row-relationship: the
 * surface's `tiers` list is unconditional. Only listed tiers leave; `secret`
 * is always stripped.
 */
import { outboundCall, type OutboundPayload } from '@/security/outbound';
import { defineOutbound } from '@/security/core';

// Capture what the network layer would see, without sending anything.
function capture(surface: string, payload: OutboundPayload): Promise<OutboundPayload> {
    return outboundCall(surface, payload, async stripped => stripped);
}

// ─── public-only surface (shopify.product.create, tiers ['public']) ─────────

describe('outboundCall — public-only surface (shopify.product.create)', () => {
    it('keeps public fields, drops pii/personal/internal', async () => {
        const out = (await capture('shopify.product.create', {
            Program: {
                id: 1,
                name: 'Robotics',          // public
                memberPriceCents: 5000,    // public
                maxParticipants: 12,       // public
                leadMentorNotificationSettings: { email: true }, // personal
            },
        })) as { Program: Record<string, unknown> };
        expect(out.Program.id).toBe(1);
        expect(out.Program.name).toBe('Robotics');
        expect(out.Program.memberPriceCents).toBe(5000);
        expect(out.Program.maxParticipants).toBe(12);
        // personal field must not reach a public-only surface.
        expect(out.Program.leadMentorNotificationSettings).toBeUndefined();
    });

    it('strips pii (email/phone/dob) and internal from a Participant', async () => {
        const out = (await capture('shopify.product.create', {
            Participant: {
                id: 5,
                name: 'Me',                // public
                email: 'me@x.com',         // pii
                phone: '555',              // pii
                dob: '2000-01-01',         // pii
                notificationSettings: { x: 1 }, // personal
                emailVerified: '2026-01-01',    // internal
            },
        })) as { Participant: Record<string, unknown> };
        expect(out.Participant.id).toBe(5);
        expect(out.Participant.name).toBe('Me');
        expect(out.Participant.email).toBeUndefined();
        expect(out.Participant.phone).toBeUndefined();
        expect(out.Participant.dob).toBeUndefined();
        expect(out.Participant.notificationSettings).toBeUndefined();
        expect(out.Participant.emailVerified).toBeUndefined();
    });
});

// ─── pii surface (email.admin-notify, tiers ['public','pii']) ───────────────

describe('outboundCall — pii surface (email.admin-notify)', () => {
    it('keeps public + pii, still drops personal/internal', async () => {
        const out = (await capture('email.admin-notify', {
            Participant: {
                id: 5,
                name: 'Me',                // public  → kept
                email: 'me@x.com',         // pii     → kept
                phone: '555',              // pii     → kept
                notificationSettings: { x: 1 }, // personal → dropped
                emailVerified: '2026-01-01',    // internal → dropped
                sysadmin: true,                 // internal → dropped
            },
        })) as { Participant: Record<string, unknown> };
        expect(out.Participant.id).toBe(5);
        expect(out.Participant.name).toBe('Me');
        expect(out.Participant.email).toBe('me@x.com');
        expect(out.Participant.phone).toBe('555');
        expect(out.Participant.notificationSettings).toBeUndefined();
        expect(out.Participant.emailVerified).toBeUndefined();
        expect(out.Participant.sysadmin).toBeUndefined();
    });
});

// ─── secret tier is ALWAYS stripped, regardless of surface tier ─────────────

describe('outboundCall — secret is unconditionally stripped', () => {
    // `secret` is not even a registerable outbound tier (VALID_SENSITIVE_TIERS =
    // pii/personal/internal). Register a test surface granting EVERY valid tier
    // up to internal, so a leaked secret can't be blamed on a missing tier grant
    // — the internal fields on the same row prove the surface is maximally open.
    beforeAll(() => {
        defineOutbound({
            surface: 'test.max-tier',
            tiers: ['public', 'pii', 'personal', 'internal'],
        });
    });

    it('drops secret token fields while keeping internal on the same row', async () => {
        const out = (await capture('test.max-tier', {
            Account: {
                id: 'acc1',          // internal → kept (proves surface is open)
                userId: 5,           // internal → kept
                type: 'oauth',       // internal → kept
                provider: 'google',  // internal → kept
                refresh_token: 'rt', // secret   → stripped
                access_token: 'at',  // secret   → stripped
                id_token: 'idt',     // secret   → stripped
            },
        })) as { Account: Record<string, unknown> };
        expect(out.Account.id).toBe('acc1');
        expect(out.Account.userId).toBe(5);
        expect(out.Account.type).toBe('oauth');
        expect(out.Account.provider).toBe('google');
        // The whole point: secret never leaves, even on a maximally-open surface.
        expect(out.Account.refresh_token).toBeUndefined();
        expect(out.Account.access_token).toBeUndefined();
        expect(out.Account.id_token).toBeUndefined();
    });
});

// ─── nested relations are recursively stripped ──────────────────────────────

describe('outboundCall — nested relations', () => {
    it('strips a nested relation by ITS model tiers, not the parent key', async () => {
        // pii surface: Household.line1 is 'personal' → must be stripped even
        // though the parent Participant carries pii the surface allows.
        const out = (await capture('email.admin-notify', {
            Participant: {
                id: 5,
                name: 'Me',
                email: 'me@x.com', // pii → kept
                household: {
                    id: 2,
                    name: 'Home',        // public → kept
                    line1: 'private st', // personal → stripped
                },
            },
        })) as { Participant: Record<string, unknown> };
        expect(out.Participant.email).toBe('me@x.com');
        const hh = out.Participant.household as Record<string, unknown>;
        expect(hh.id).toBe(2);
        expect(hh.name).toBe('Home');
        expect(hh.line1).toBeUndefined();
    });

    it('recurses into list relations (Household.emergencyContacts)', async () => {
        const out = (await capture('email.admin-notify', {
            Household: {
                id: 2,
                name: 'Home',
                emergencyContacts: [
                    { id: 1, name: 'Aunt May', phone: '555-1234', priority: 1 },
                ],
            },
        })) as { Household: Record<string, unknown> };
        const ecs = out.Household.emergencyContacts as Record<string, unknown>[];
        const ec = ecs[0];
        // EmergencyContact: id/priority public, name/phone personal. pii surface
        // keeps public, strips personal — recursion must apply the nested model's
        // own tiers, not pass the row through untouched.
        expect(ec.id).toBe(1);
        expect(ec.priority).toBe(1);
        expect(ec.name).toBeUndefined();
        expect(ec.phone).toBeUndefined();
    });
});

// ─── fail-closed: unknown model / unknown surface throw ─────────────────────

describe('outboundCall — fail-closed', () => {
    it('throws on an unknown / unclassified model key (no passthrough)', async () => {
        await expect(
            capture('shopify.product.create', { NotARealModelXYZ: { foo: 'bar' } }),
        ).rejects.toThrow(/not a known model/);
    });

    it('throws on an unregistered outbound surface', async () => {
        await expect(
            capture('shopify.no.such.surface', { Program: { id: 1 } }),
        ).rejects.toThrow(/No registered outbound surface/);
    });
});
