import { serializeMembershipForm } from "@/app/membership/page";

const base = {
  address: { line1: "1 A St", line2: "", city: "Austin", state: "TX", postalCode: "78701" },
  emName: "Jo", emPhone: "555", emEmail: "",
  primaryName: "Pat", primaryDob: "1990-01-01", primaryAllergies: "",
  hasSecondary: false, secondaryId: undefined,
  secondaryName: "", secondaryEmail: "", secondaryDob: "", secondaryAllergies: "",
  children: [{ id: 1, name: "Kid", email: "", dob: "2015-02-02", allergies: "peanuts" }],
};

describe("serializeMembershipForm (unsaved-changes dirty compare)", () => {
  it("identical values → equal key (clean form → not dirty)", () => {
    expect(serializeMembershipForm(base)).toBe(serializeMembershipForm({ ...base }));
  });

  it("a changed top-level field → different key (dirty)", () => {
    expect(serializeMembershipForm(base)).not.toBe(serializeMembershipForm({ ...base, emName: "Sam" }));
  });

  it("a nested address change → different key (where flat compare would miss it)", () => {
    const next = { ...base, address: { ...base.address, city: "Dallas" } };
    expect(serializeMembershipForm(base)).not.toBe(serializeMembershipForm(next));
  });

  it("a nested child change → different key", () => {
    const next = { ...base, children: [{ ...base.children[0], allergies: "none" }] };
    expect(serializeMembershipForm(base)).not.toBe(serializeMembershipForm(next));
  });
});
