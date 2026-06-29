import { GET } from "../route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { ORG_DOMAIN } from "@/lib/config";

jest.mock("next-auth/next");
const mockGetServerSession = getServerSession as jest.Mock;

// Member-family count = households with >=1 non-org participant. Treehouse staff households
// (size 1, only an @innovationtreehouse.org lead) and empty households are excluded.
describe("Member family count API", () => {
    const ids: number[] = [];

    async function household(emails: (string | null)[]) {
        const hh = await prisma.household.create({ data: { name: "Count Test" } });
        ids.push(hh.id);
        for (const email of emails) {
            await prisma.participant.create({ data: { name: "P", email, householdId: hh.id } });
        }
        return hh.id;
    }

    async function count(): Promise<number> {
        const req = new Request("http://t/api/admin/households/member-count") as unknown as import("next/server").NextRequest;
        const res = await GET(req);
        return (await res.json()).count;
    }

    beforeEach(() => {
        mockGetServerSession.mockResolvedValue({
            user: { id: 0, email: "actor@checkme.in", boardMember: true },
        });
    });

    afterEach(async () => {
        await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
        ids.length = 0;
    });

    it("counts families with a non-org member, ignores staff-only and empty households", async () => {
        const before = await count();

        await household([`staff@${ORG_DOMAIN}`]);            // staff household — excluded
        await household([]);                                  // empty — excluded
        await household(["parent@example.com"]);              // member family — counted
        await household([`staff2@${ORG_DOMAIN}`, "kid@x.com"]); // mixed — counted
        await household([null]);                              // child, no email — counted

        expect(await count()).toBe(before + 3);
    });
});
