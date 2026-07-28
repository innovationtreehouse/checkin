import { describe, it, expect } from "vitest";
import { SyncEventSchema } from "../../src/handler.js";

describe("SyncEventSchema", () => {
  it("defaults to incremental when empty", () => {
    expect(SyncEventSchema.parse({})).toEqual({ mode: "incremental" });
  });

  it("accepts an explicit backfill mode", () => {
    expect(SyncEventSchema.parse({ mode: "backfill" })).toEqual({ mode: "backfill" });
  });

  it("rejects an unknown mode", () => {
    expect(() => SyncEventSchema.parse({ mode: "sideways" })).toThrow();
  });

  it("rejects unknown keys (strict contract)", () => {
    expect(() => SyncEventSchema.parse({ mode: "incremental", extra: 1 })).toThrow();
  });
});
