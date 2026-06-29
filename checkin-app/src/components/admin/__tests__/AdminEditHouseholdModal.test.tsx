import { isFormDirty } from "../AdminEditHouseholdModal";

const base = { name: "Smith", line1: "1 Main", line2: "", city: "Austin", state: "TX", postalCode: "78701", emergencyContactName: "Jo", emergencyContactPhone: "5550000" };

describe("isFormDirty", () => {
  it("is false when snapshots match", () => {
    expect(isFormDirty(base, { ...base })).toBe(false);
  });

  it("is true when any field differs", () => {
    expect(isFormDirty(base, { ...base, name: "Jones" })).toBe(true);
    expect(isFormDirty(base, { ...base, emergencyContactPhone: "5551111" })).toBe(true);
  });
});
