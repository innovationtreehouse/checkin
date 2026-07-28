import { normalizeAdultDob } from "@/lib/person/adultDob";

// #1165: no DoB above the program-age ceiling (25). The boundary is the whole point.
describe("normalizeAdultDob", () => {
  const yearsAgo = (n: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - n);
    // step off the birthday so age math is unambiguous mid-year
    d.setDate(d.getDate() - 1);
    return d;
  };

  it("clears the date and leaves the flag alone for empty input", () => {
    expect(normalizeAdultDob(null)).toEqual({ dateOfBirth: null });
    expect(normalizeAdultDob(undefined)).toEqual({ dateOfBirth: null });
    expect(normalizeAdultDob("")).toEqual({ dateOfBirth: null });
  });

  it("keeps a real DoB and un-declares for age <= 25", () => {
    const dob = yearsAgo(25);
    expect(normalizeAdultDob(dob)).toEqual({ dateOfBirth: dob, isDeclaredAdult: false });
    const teen = yearsAgo(14);
    expect(normalizeAdultDob(teen)).toEqual({ dateOfBirth: teen, isDeclaredAdult: false });
  });

  it("strips the DoB and declares adult for age > 25", () => {
    expect(normalizeAdultDob(yearsAgo(26))).toEqual({ dateOfBirth: null, isDeclaredAdult: true });
    expect(normalizeAdultDob(yearsAgo(40))).toEqual({ dateOfBirth: null, isDeclaredAdult: true });
  });
});
