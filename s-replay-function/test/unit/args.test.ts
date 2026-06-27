import { describe, it, expect } from "vitest";
import { flag } from "../../src/args.js";

describe("flag() argv parser", () => {
  it("reads the `--k=v` form", () => {
    expect(flag(["--reason=fix it"], "--reason")).toBe("fix it");
  });

  it("reads the `--k v` (space) form", () => {
    expect(flag(["--reason", "fix it"], "--reason")).toBe("fix it");
  });

  it("prefers the `=`-form over the space-form when both are present", () => {
    expect(flag(["--store", "space-store", "--store=eq-store"], "--store")).toBe("eq-store");
  });

  it("returns undefined when the next token looks like another flag", () => {
    expect(flag(["--reason", "--actor", "ops:jane"], "--reason")).toBeUndefined();
  });

  it("returns undefined when the space-form value is missing (flag is last token)", () => {
    expect(flag(["--reason"], "--reason")).toBeUndefined();
  });

  it("returns undefined for an absent flag", () => {
    expect(flag(["--reason", "fix"], "--actor")).toBeUndefined();
  });

  it("returns undefined for empty args", () => {
    expect(flag([], "--reason")).toBeUndefined();
  });

  it("accepts an empty `=`-form value", () => {
    expect(flag(["--store="], "--store")).toBe("");
  });
});
