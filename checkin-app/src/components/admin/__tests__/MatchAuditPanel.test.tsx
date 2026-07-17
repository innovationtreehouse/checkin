import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import { MatchAuditPanel } from "../MatchAuditPanel";

beforeEach(() => resetRtl());

const AUDIT_URL = "/api/finance-ops/s-read/match-audit";

describe("MatchAuditPanel", () => {
  it("does not run until clicked, then separates gaps from legitimate manual rows", async () => {
    mockFetchJson({
      [AUDIT_URL]: {
        variantCoverage: { lines: 6, withVariant: 6 },
        orders: [
          { bucket: "MATCHED", orderLegacyId: "1", name: "#1", customerEmail: "a@x.com", financialStatus: "PAID", totalCents: 5000, expected: ["membership"] },
          { bucket: "UNCLAIMED_PAID", orderLegacyId: "2", name: "#2", customerEmail: "b@x.com", financialStatus: "PAID", totalCents: 7500, expected: ["program: Robotics"] },
        ],
        memberships: [
          { bucket: "MANUAL_CERTIFIED", processId: 3, householdName: "The Larks", shopifyOrderId: null, certifiedByName: "Board Bob" },
          { bucket: "NO_PAYMENT_BASIS", processId: 4, householdName: "The Wrens", shopifyOrderId: null, certifiedByName: null },
        ],
        enrollments: [
          { bucket: "SCHOLARSHIP_APPROVED", programId: 7, programName: "Robotics", personId: 9, personName: "Kid Nine", shopifyOrderId: null },
        ],
      },
    });
    renderWithProviders(<MatchAuditPanel />);

    // Inert until asked — the audit sweeps the mirror and wakes the cluster.
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));

    // The two gap classes render as rows...
    expect(await screen.findByText("2 gap(s)")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("program: Robotics")).toBeInTheDocument();
    expect(screen.getByText("No order and no certification")).toBeInTheDocument();
    // ...and the manual class is listed with WHO certified, not flagged as a gap.
    expect(screen.getByText("Certified by Board Bob")).toBeInTheDocument();
    expect(screen.getByText("Scholarship / payment plan approved")).toBeInTheDocument();
    // Matched orders stay a count, never a table row.
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
  });

  it("shows a clean badge when nothing is wrong", async () => {
    mockFetchJson({
      [AUDIT_URL]: { variantCoverage: { lines: 6, withVariant: 6 }, orders: [], memberships: [], enrollments: [] },
    });
    renderWithProviders(<MatchAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));
    expect(await screen.findByText("No gaps")).toBeInTheDocument();
  });

  it("calls out a variant-blind mirror instead of reporting a falsely clean audit", async () => {
    mockFetchJson({
      [AUDIT_URL]: { variantCoverage: { lines: 9, withVariant: 0 }, orders: [], memberships: [], enrollments: [] },
    });
    renderWithProviders(<MatchAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));
    expect(await screen.findByText(/predates variant mirroring/)).toBeInTheDocument();
  });

  it("explains an unwired mirror on 503", async () => {
    mockFetchJson({}); // unmatched URL → non-ok
    renderWithProviders(<MatchAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run match audit/ }));
    expect(await screen.findByText(/failed to run/)).toBeInTheDocument();
  });
});
