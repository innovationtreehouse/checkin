import { describe, it, expect } from "vitest";
import { AdminEventSchema } from "../../src/handler.js";

const base = { mode: "replay", actor: "ops:jane", reason: "reproject after fix" } as const;

describe("AdminEventSchema", () => {
  it("accepts a well-formed replay event", () => {
    const parsed = AdminEventSchema.parse({ ...base, objectType: "ORDER", since: "2026-01-01T00:00:00Z" });
    expect(parsed.mode).toBe("replay");
    expect(parsed.actor).toBe("ops:jane");
    expect(parsed.reason).toBe("reproject after fix");
  });

  it("requires actor (audit attribution)", () => {
    expect(() => AdminEventSchema.parse({ mode: "replay", reason: "x" })).toThrow();
  });

  it("requires reason (audit justification)", () => {
    expect(() => AdminEventSchema.parse({ mode: "replay", actor: "ops:jane" })).toThrow();
  });

  it("rejects a non-ISO since", () => {
    expect(() => AdminEventSchema.parse({ ...base, since: "yesterday" })).toThrow();
  });

  it("rejects an invalid objectType", () => {
    expect(() => AdminEventSchema.parse({ ...base, objectType: "WIDGET" })).toThrow();
  });

  it("rejects unknown keys (strict contract)", () => {
    expect(() => AdminEventSchema.parse({ ...base, sneaky: true })).toThrow();
  });

  it("accepts reset-watermark with a null `to`", () => {
    const parsed = AdminEventSchema.parse({ mode: "reset-watermark", actor: "ops:jane", reason: "clear", to: null });
    expect(parsed.mode).toBe("reset-watermark");
    expect(parsed.to).toBeNull();
  });

  it("accepts reingest-bulk with a since floor and bulk operation id", () => {
    const parsed = AdminEventSchema.parse({
      mode: "reingest-bulk",
      actor: "ops:jane",
      reason: "repair backfill after reassembly fix",
      since: "2026-01-01T00:00:00Z",
      bulkOperationId: "gid://shopify/BulkOperation/123",
    });
    expect(parsed.mode).toBe("reingest-bulk");
    expect(parsed.bulkOperationId).toBe("gid://shopify/BulkOperation/123");
  });
});
