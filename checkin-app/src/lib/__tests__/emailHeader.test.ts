import { isValidEmailHeader } from '../emailHeader';

describe('isValidEmailHeader', () => {
    it.each([
        'a@b.co',
        'first.last@sub.example.org',
        'Innovation Treehouse <noreply@updates.example.org>',
        'Name <a@b.co>',
    ])('accepts %s', (v) => expect(isValidEmailHeader(v)).toBe(true));

    it.each([
        'not-an-email',
        'missing-at.example.org',
        'no-domain@',
        '@no-local.org',
        'spaces in@addr.org',
        'Name <not-an-email>',
    ])('rejects %s', (v) => expect(isValidEmailHeader(v)).toBe(false));
});
