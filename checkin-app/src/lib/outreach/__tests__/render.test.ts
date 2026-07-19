import { renderOutreachEmail } from '@/lib/outreach/render';

describe('renderOutreachEmail', () => {
    const prevSecret = process.env.NEXTAUTH_SECRET;
    const prevUrl = process.env.NEXTAUTH_URL;
    const boundary = new Date(Date.UTC(2026, 7, 1)); // Aug 1 2026

    beforeAll(() => {
        process.env.NEXTAUTH_SECRET = 'unit-test-nextauth-secret';
        process.env.NEXTAUTH_URL = 'http://localhost:4000';
    });
    afterAll(() => {
        if (prevSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = prevSecret;
        if (prevUrl === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = prevUrl;
    });

    it('renders {{deadline}} as YYYY-MM-DD from the resolved boundary', () => {
        const { subject } = renderOutreachEmail('Renew by {{deadline}}', 'body', { name: 'A', variant: 'renew', boundary });
        expect(subject).toBe('Renew by 2026-08-01');
    });

    it('escapes {{name}} — an XSS payload in the name renders as text', () => {
        const { html } = renderOutreachEmail('s', 'Hello {{name}}', {
            name: '<script>alert(1)</script>', variant: 'join', boundary, personId: 1,
        });
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('actionWord is "renew" for the renew variant and "join" for join', () => {
        const renew = renderOutreachEmail('{{actionWord}}', 'b', { name: 'A', variant: 'renew', boundary });
        const join = renderOutreachEmail('{{actionWord}}', 'b', { name: 'A', variant: 'join', boundary, personId: 1 });
        expect(renew.subject).toBe('renew');
        expect(join.subject).toBe('join');
    });

    it('actionLink is /membership for BOTH variants', () => {
        const renew = renderOutreachEmail('s', '{{actionLink}}', { name: 'A', variant: 'renew', boundary });
        const join = renderOutreachEmail('s', '{{actionLink}}', { name: 'A', variant: 'join', boundary, personId: 1 });
        // Renew has no footer, so its body IS the rendered actionLink, verbatim.
        expect(renew.html).toBe('http://localhost:4000/membership');
        // Join gets the same actionLink, plus its footer appended after it.
        expect(join.html.startsWith('http://localhost:4000/membership')).toBe(true);
    });

    it('appends the unsubscribe footer to the JOIN variant only, when a personId is given', () => {
        const join = renderOutreachEmail('s', 'body', { name: 'A', variant: 'join', boundary, personId: 99 });
        const renew = renderOutreachEmail('s', 'body', { name: 'A', variant: 'renew', boundary, personId: 99 });
        expect(join.html).toContain('Unsubscribe from invitations');
        expect(join.html).toContain('/api/unsubscribe?p=99&sig=');
        expect(renew.html).not.toContain('Unsubscribe from invitations');
    });

    it('omits the footer for a join render with no personId (e.g. a preview with no real recipient)', () => {
        const { html } = renderOutreachEmail('s', 'body', { name: 'A', variant: 'join', boundary });
        expect(html).not.toContain('Unsubscribe from invitations');
    });
});
