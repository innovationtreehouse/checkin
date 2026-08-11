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

    it('disambiguates against the cohort, not the printed batch', () => {
        const cohort = [
            { id: 1, name: 'John Smith' },
            { id: 2, name: 'John Doe' },
            { id: 3, name: 'Jane Roe' },
        ];
        // One badge printed alone still reads as it does when the whole cohort is printed.
        expect(computeDisplayNames([cohort[0]], cohort).get(1)).toBe('John S.');
        expect(computeDisplayNames(cohort, cohort).get(1)).toBe('John S.');
        // A cohort member with a unique first name keeps the bare first name.
        expect(computeDisplayNames([cohort[2]], cohort).get(3)).toBe('Jane');
    });

    it('disambiguates a non-cohort subject against the cohort', () => {
        const cohort = [{ id: 1, name: 'John Smith' }];
        // A guest badge (not an active member) still has to be distinguishable from the members.
        expect(computeDisplayNames([{ id: 9, name: 'John Doe' }], cohort).get(9)).toBe('John D.');
    });
});
