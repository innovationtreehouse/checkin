import { getKioskDisplayNames } from "../kiosk-names";

describe("getKioskDisplayNames", () => {
    it("returns first name only for a single participant", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "Sarah Johnson", email: "sarah@example.com" },
        ]);
        expect(map.get(1)).toBe("Sarah");
    });

    it("returns first names only when all are unique", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "Sarah Johnson", email: "sarah@example.com" },
            { id: 2, name: "Mike Smith", email: "mike@example.com" },
            { id: 3, name: "Alex Rivera", email: "alex@example.com" },
        ]);
        expect(map.get(1)).toBe("Sarah");
        expect(map.get(2)).toBe("Mike");
        expect(map.get(3)).toBe("Alex");
    });

    it("disambiguates with 1-char last initial when first names collide", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "Sarah Miller", email: "sarah.m@example.com" },
            { id: 2, name: "Sarah Kim", email: "sarah.k@example.com" },
        ]);
        expect(map.get(1)).toBe("Sarah M.");
        expect(map.get(2)).toBe("Sarah K.");
    });

    it("disambiguates with 2-char last prefix when last initials also collide", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "Sarah Morris", email: "sarah.mo@example.com" },
            { id: 2, name: "Sarah Martinez", email: "sarah.ma@example.com" },
        ]);
        expect(map.get(1)).toBe("Sarah Mo.");
        expect(map.get(2)).toBe("Sarah Ma.");
    });

    it("handles a mix of unique and colliding first names", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "Sarah Morris", email: "sarah.mo@example.com" },
            { id: 2, name: "Sarah Martinez", email: "sarah.ma@example.com" },
            { id: 3, name: "Mike Smith", email: "mike@example.com" },
        ]);
        expect(map.get(1)).toBe("Sarah Mo.");
        expect(map.get(2)).toBe("Sarah Ma.");
        expect(map.get(3)).toBe("Mike");
    });

    it("falls back to email prefix when name is null", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: null, email: "jdoe@example.com" },
        ]);
        expect(map.get(1)).toBe("jdoe");
    });

    it("handles 'Last, First' comma format", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "Johnson, Sarah", email: "sarah@example.com" },
            { id: 2, name: "Kim, Sarah", email: "sarah.k@example.com" },
        ]);
        expect(map.get(1)).toBe("Sarah J.");
        expect(map.get(2)).toBe("Sarah K.");
    });

    it("handles single-word names (no last name)", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "Cher", email: "cher@example.com" },
        ]);
        expect(map.get(1)).toBe("Cher");
    });

    it("handles duplicate first names where one has no last name", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "Alex", email: "alex1@example.com" },
            { id: 2, name: "Alex Rivera", email: "alex2@example.com" },
        ]);
        expect(map.get(1)).toBe("Alex");
        expect(map.get(2)).toBe("Alex R.");
    });

    it("is case-insensitive for first name grouping", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "sarah Miller", email: "sarah.m@example.com" },
            { id: 2, name: "Sarah Kim", email: "sarah.k@example.com" },
        ]);
        expect(map.get(1)).toBe("sarah M.");
        expect(map.get(2)).toBe("Sarah K.");
    });

    it("handles three-way collision with mixed last initials", () => {
        const map = getKioskDisplayNames([
            { id: 1, name: "Sarah Morris", email: "s1@example.com" },
            { id: 2, name: "Sarah Martinez", email: "s2@example.com" },
            { id: 3, name: "Sarah Kim", email: "s3@example.com" },
        ]);
        // Morris and Martinez share 'M', so get 2-char; Kim is unique initial
        expect(map.get(1)).toBe("Sarah Mo.");
        expect(map.get(2)).toBe("Sarah Ma.");
        expect(map.get(3)).toBe("Sarah K.");
    });
});
