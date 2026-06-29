import { computeDisplayNames } from '@/components/admin/badgeNames';

const run = (names: string[]) => {
    const map = computeDisplayNames(names.map((name, i) => ({ id: i, name })));
    return names.map((_, i) => map.get(i));
};

describe('computeDisplayNames', () => {
    it('uses first name only when unique', () => {
        expect(run(['Jane Smith', 'Bob Jones'])).toEqual(['Jane', 'Bob']);
    });

    it('adds last initial when first names collide', () => {
        expect(run(['John Smith', 'John Doe'])).toEqual(['John S.', 'John D.']);
    });

    it('grows the prefix to the minimum needed to disambiguate', () => {
        expect(run(['John Smith', 'John Smythe'])).toEqual(['John Smi.', 'John Smy.']);
    });

    it('falls back to full last name for identical names', () => {
        expect(run(['John Smith', 'John Smith'])).toEqual(['John Smith', 'John Smith']);
    });

    it('shows bare first name for the entry lacking a last name; others disambiguate around it', () => {
        expect(run(['John', 'John Smith'])).toEqual(['John', 'John S.']);
    });
});
