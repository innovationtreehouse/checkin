import { isValidEmailHeader, parseEmailHeaderList } from '../emailHeader';

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

describe('parseEmailHeaderList', () => {
    it('accepts a single address as a one-element array', () => {
        expect(parseEmailHeaderList('a@b.co')).toEqual(['a@b.co']);
    });

    it('accepts a comma-separated list, trimming spaces around entries', () => {
        expect(parseEmailHeaderList('a@b.co,  c@d.co')).toEqual(['a@b.co', 'c@d.co']);
    });

    it('accepts display-name entries within a list', () => {
        expect(parseEmailHeaderList('Info <info@x.org>, Ops <ops@x.org>')).toEqual(['Info <info@x.org>', 'Ops <ops@x.org>']);
    });

    it('dedupes exact-duplicate entries', () => {
        expect(parseEmailHeaderList('a@b.co, a@b.co')).toEqual(['a@b.co']);
    });

    it('rejects the whole list when any one entry is malformed', () => {
        expect(parseEmailHeaderList('a@b.co, not-an-email')).toBeNull();
    });

    it.each(['', '   ', ','])('rejects a blank value %j', (v) => {
        expect(parseEmailHeaderList(v)).toBeNull();
    });
});
