import { matchesPersonQuery, searchId } from '@/lib/searchId';

describe('searchId', () => {
    it('reads a bare number as an id', () => {
        expect(searchId('42')).toBe(42);
        expect(searchId('  42  ')).toBe(42);
    });

    it('is null for anything that is not all digits', () => {
        expect(searchId('ali')).toBeNull();
        expect(searchId('42a')).toBeNull();
        expect(searchId('4 2')).toBeNull();
        expect(searchId('-1')).toBeNull();
        expect(searchId('4.2')).toBeNull();
        expect(searchId('')).toBeNull();
    });

    it('is null past the int4 ceiling, which no id reaches', () => {
        expect(searchId('2147483647')).toBe(2147483647);
        expect(searchId('2147483648')).toBeNull();
        expect(searchId('99999999999999999999')).toBeNull();
    });
});

describe('matchesPersonQuery', () => {
    const person = { id: 42, name: 'Ali Ada', email: 'ali@example.com' };

    it('matches on name or email, case-insensitively', () => {
        expect(matchesPersonQuery(person, 'ali')).toBe(true);
        expect(matchesPersonQuery(person, 'ADA')).toBe(true);
        expect(matchesPersonQuery(person, 'EXAMPLE.com')).toBe(true);
        expect(matchesPersonQuery(person, 'bob')).toBe(false);
    });

    it('matches the id exactly, not as a substring', () => {
        expect(matchesPersonQuery(person, '42')).toBe(true);
        expect(matchesPersonQuery(person, ' 42 ')).toBe(true);
        expect(matchesPersonQuery(person, '4')).toBe(false);
    });

    it('matches everything on an empty query', () => {
        expect(matchesPersonQuery(person, '')).toBe(true);
        expect(matchesPersonQuery(person, '   ')).toBe(true);
    });

    it('does not match on a field the caller did not supply', () => {
        expect(matchesPersonQuery({ id: 42, name: 'Ali Ada' }, 'example.com')).toBe(false);
    });
});
