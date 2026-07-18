import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import { MatchAuditPanel } from "../MatchAuditPanel";

beforeEach(() => resetRtl());

const AUDIT_URL = "/api/finance-ops/s-read/match-audit";

describe("MatchAuditPanel", () => {
  it("does not run until clicked, then separates gaps from legitimate manual rows", async () => {
    mockFetchJson({
      [AUDIT_URL]: {
        configured: true,
        configuredVariants: 3,
        variantCoverage: { lines: 6, withVariant: 6 },
        orders: [
          { bucket: "MATCHED", orderLegacyId: "1", name: "#1", customerEmail: "a@x.com", financialStatus: "PAID", totalCents: 5000, discountCodes: [], expected: ["membership"] },
          { bucket: "UNCLAIMED_PAID", orderLegacyId: "2", name: "#2", customerEmail: "b@x.com", financialStatus: "PAID", totalCents: 7500, discountCodes: ["VOL50"], expected: ["program: Robotics"] },
        ],
        memberships: [
          { bucket: "MANUAL_CERTIFIED", processId: 3, membershipId: null, householdName: "The Larks", shopifyOrderId: null, certifiedByName: "Board Bob" },
          { bucket: "NO_PAYMENT_BASIS", processId: 4, membershipId: null, householdName: "The Wrens", shopifyOrderId: null, certifiedByName: null },
          { bucket: "NO_PROCESS", processId: null, membershipId: 5, householdName: "The Finches", shopifyOrderId: null, certifiedByName: null },
          { bucket: "ORDER_REVERSED", processId: 6, membershipId: null, householdName: "The Sparrows", shopifyOrderId: "801", certifiedByName: null },
        ],
        enrollments: [
          { bucket: "SCHOLARSHIP_APPROVED", programId: 7, programName: "Robotics", personId: 9, personName: "Kid Nine", shopifyOrderId: null, compedByName: null },
          { bucket: "ADMIN_COMPED", programId: 7, programName: "Robotics", personId: 10, personName: "Kid Ten", shopifyOrderId: null, compedByName: "Admin Amy" },
          { bucket: "ORDER_REVERSED", programId: 7, programName: "Robotics", personId: 11, personName: "Kid Eleven", shopifyOrderId: "701", compedByName: null },
          { bucket: "PRE_MIRROR", programId: 7, programName: "Robotics", personId: 12, personName: "Kid Twelve", shopifyOrderId: "50", compedByName: null },
        ],
      },
    });
    renderWithProviders(<MatchAuditPanel />);

    // Inert until asked — the audit sweeps the mirror and wakes the cluster.
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));

    // The gap classes render as rows — unclaimed paid, membership NO_PAYMENT_BASIS,
    // and NO_PROCESS all count as gaps (3 gap(s)); reversed + pre-mirror do not.
    expect(await screen.findByText("3 gap(s)")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("program: Robotics")).toBeInTheDocument();
    expect(screen.getByText("VOL50")).toBeInTheDocument();
    expect(screen.getByText("No order and no certification")).toBeInTheDocument();
    expect(screen.getByText("Active membership with no INITIAL/RENEWAL process")).toBeInTheDocument();
    // ...and the manual/scholarship/comped classes are listed with WHO, not flagged as gaps.
    expect(screen.getByText("Certified by Board Bob")).toBeInTheDocument();
    expect(screen.getByText("Scholarship / payment plan approved")).toBeInTheDocument();
    expect(screen.getByText("Comped by Admin Amy")).toBeInTheDocument();
    // Reversed rows render informationally, not as a gap.
    expect(screen.getByText("Reversed after activation — already in the exceptions queue")).toBeInTheDocument();
    expect(screen.getByText("Membership process 6")).toBeInTheDocument();
    // Pre-mirror is a count only, no row.
    expect(screen.getByText(/Pre-mirror \(before mirror history\)/)).toBeInTheDocument();
    expect(screen.queryByText("Kid Twelve")).not.toBeInTheDocument();
    // Matched orders stay a count, never a table row.
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
  });

  it("shows a clean badge when nothing is wrong", async () => {
    mockFetchJson({
      [AUDIT_URL]: { configured: true, configuredVariants: 3, variantCoverage: { lines: 6, withVariant: 6 }, orders: [], memberships: [], enrollments: [] },
    });
    renderWithProviders(<MatchAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));
    expect(await screen.findByText("No gaps")).toBeInTheDocument();
  });

  it("calls out a variant-blind mirror instead of reporting a falsely clean audit", async () => {
    mockFetchJson({
      [AUDIT_URL]: { configured: true, configuredVariants: 3, variantCoverage: { lines: 9, withVariant: 0 }, orders: [], memberships: [], enrollments: [] },
    });
    renderWithProviders(<MatchAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));
    expect(await screen.findByText(/predates variant mirroring/)).toBeInTheDocument();
  });

  it("calls out partially-backfilled variant coverage — absent orders, not gaps", async () => {
    mockFetchJson({
      [AUDIT_URL]: { configured: true, configuredVariants: 3, variantCoverage: { lines: 10, withVariant: 4 }, orders: [], memberships: [], enrollments: [] },
    });
    renderWithProviders(<MatchAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));
    expect(await screen.findByText(/6 of 10 mirror order lines still have no variant id/)).toBeInTheDocument();
  });

  it("calls out an unconfigured variant set instead of reporting a falsely clean audit", async () => {
    mockFetchJson({
      [AUDIT_URL]: { configured: true, configuredVariants: 0, variantCoverage: { lines: 6, withVariant: 6 }, orders: [], memberships: [], enrollments: [] },
    });
    renderWithProviders(<MatchAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));
    expect(await screen.findByText(/No membership or program variant ids are configured/)).toBeInTheDocument();
  });

  it("explains an unwired mirror on a real 503", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "",
    })) as unknown as typeof fetch;
    renderWithProviders(<MatchAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));
    expect(await screen.findByText(/not wired in this environment/)).toBeInTheDocument();
  });

  it("shows the generic failure message on any other error", async () => {
    mockFetchJson({}); // unmatched URL → 404, the generic catch path
    renderWithProviders(<MatchAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));
    expect(await screen.findByText(/failed to run/)).toBeInTheDocument();
  });
});
