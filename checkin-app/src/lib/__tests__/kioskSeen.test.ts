import { getKioskSeen, resetKioskSeen, stampKioskSeen } from "@/lib/kioskSeen";

describe("kioskSeen", () => {
    afterEach(() => resetKioskSeen());

    it("is empty until a verified request stamps it", () => {
        expect(getKioskSeen(1_000).lastSeenAt).toBeNull();
        expect(getKioskSeen(1_000).ageSeconds).toBeNull();
    });

    it("reports age in seconds from the last stamp", () => {
        stampKioskSeen(10_000);
        expect(getKioskSeen(15_500).ageSeconds).toBe(5);
        expect(getKioskSeen(15_500).lastSeenAt?.getTime()).toBe(10_000);
    });
});
