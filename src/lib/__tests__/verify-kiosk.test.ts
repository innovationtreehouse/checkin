import { getKioskPublicKeys } from "../verify-kiosk";
import { config } from "../config";

describe("getKioskPublicKeys", () => {
    let kioskPublicKeySpy: jest.SpyInstance;

    beforeEach(() => {
        kioskPublicKeySpy = jest.spyOn(config, "kioskPublicKey");
    });

    afterEach(() => {
        kioskPublicKeySpy.mockRestore();
    });

    it("returns an empty array if kioskPublicKey is not configured", () => {
        kioskPublicKeySpy.mockReturnValue(null);
        expect(getKioskPublicKeys()).toEqual([]);
    });

    it("parses a single valid hex key into an array of one Buffer", () => {
        const hexKey = "a1b2c3d4";
        kioskPublicKeySpy.mockReturnValue(hexKey);

        const result = getKioskPublicKeys();
        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(Buffer);
        expect(result[0].toString("hex")).toBe(hexKey);
    });

    it("parses multiple valid comma-separated hex keys", () => {
        const hexKey1 = "111111";
        const hexKey2 = "222222";
        kioskPublicKeySpy.mockReturnValue(`${hexKey1},${hexKey2}`);

        const result = getKioskPublicKeys();
        expect(result).toHaveLength(2);
        expect(result[0].toString("hex")).toBe(hexKey1);
        expect(result[1].toString("hex")).toBe(hexKey2);
    });

    it("ignores empty string keys or whitespace-only keys", () => {
        const hexKey1 = "333333";
        const hexKey2 = "444444";
        kioskPublicKeySpy.mockReturnValue(`${hexKey1}, ,${hexKey2},`);

        const result = getKioskPublicKeys();
        expect(result).toHaveLength(2);
        expect(result[0].toString("hex")).toBe(hexKey1);
        expect(result[1].toString("hex")).toBe(hexKey2);
    });

    it("strips out leading and trailing whitespace from keys", () => {
        const hexKey = "555555";
        kioskPublicKeySpy.mockReturnValue(`   ${hexKey}  `);

        const result = getKioskPublicKeys();
        expect(result).toHaveLength(1);
        expect(result[0].toString("hex")).toBe(hexKey);
    });
});
