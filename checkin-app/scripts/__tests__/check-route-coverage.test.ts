import { findBareIncludeLegs, findUnregisteredBareIncludeLegs } from "../check-route-coverage";

const names = (src: string) => findBareIncludeLegs(src).map(l => l.name);

describe("findBareIncludeLegs", () => {
    it("flags a bare-true leg directly inside include", () => {
        expect(names(`prisma.person.findMany({ include: { rel: true } })`)).toEqual(["rel"]);
    });

    it("ignores a fully-projected query with no include at all", () => {
        expect(names(`prisma.person.findMany({ select: { rel: { select: { id: true } } } })`)).toEqual([]);
    });

    it("ignores a bare-true leg inside select — that is how you narrow a query", () => {
        expect(names(`select: { id: true, name: true, isHouseholdLead: true }`)).toEqual([]);
    });

    it("ignores _count, which returns integers rather than rows", () => {
        expect(names(`include: { _count: { select: { visits: true } } }`)).toEqual([]);
    });

    // The case that actually pins the block-kind tracking: one include block
    // containing a nested-block leg, a nested include, and a nested select.
    it("tracks the nearest enclosing block through nesting", () => {
        const src = `
            include: {
                household: {
                    include: {
                        householdMembers: true,
                    },
                    select: { id: true, name: true },
                },
                _count: { select: { visits: true } },
                orgMembership: true,
            }
        `;
        expect(names(src)).toEqual(["householdMembers", "orgMembership"]);
    });

    it("reports the line of the offending leg", () => {
        expect(findBareIncludeLegs("a\nb\ninclude: {\n  rel: true,\n}")).toEqual([{ name: "rel", line: 4 }]);
    });

    it("does not let braces in a blanked comment skew the brace stack", () => {
        const src = `
            select: {
                // include: { leaked: true
                id: true,
            }
        `;
        expect(names(src)).toEqual([]);
    });

    it("does not match true legs mid-identifier", () => {
        expect(names(`include: { a_rel: true }`)).toEqual(["a_rel"]);
        expect(names(`include: { x.rel: true }`)).toEqual([]);
    });
});

describe("findUnregisteredBareIncludeLegs", () => {
    const BODY = `export async function GET() { return prisma.p.findMany({ include: { rel: true } }) }`;

    it("flags the leg when no verb of the route is registered", () => {
        const legs = findUnregisteredBareIncludeLegs(BODY, ["GET"], "/api/thing", new Set());
        expect(legs.map(l => l.name)).toEqual(["rel"]);
    });

    it("stays silent on a registered route — handler()'s stripper covers it", () => {
        const registered = new Set(["GET /api/thing"]);
        expect(findUnregisteredBareIncludeLegs(BODY, ["GET"], "/api/thing", registered)).toEqual([]);
    });

    it("stays silent on a file that exports no verbs", () => {
        expect(findUnregisteredBareIncludeLegs(BODY, [], "/api/thing", new Set())).toEqual([]);
    });
});
