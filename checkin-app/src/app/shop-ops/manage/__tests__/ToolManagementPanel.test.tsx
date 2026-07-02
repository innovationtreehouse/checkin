// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import { ToolManagementPanel } from "../ToolManagementPanel";

// ponytail: GrantForm's Select-based certify flow isn't exercised — Mantine
// Select needs Combobox option clicks, not fireEvent.change; skipped as a
// modal/validation branch per the coverage plan's scope. Add if it regresses.
//
// Note: GrantForm's member/tool Select mounts its option list in the DOM even
// closed, so a name that's also a Select option (e.g. "Alice" as a member
// option) matches twice. Where that collides, assertions below scope to the
// Mantine <Text> ("p") that renders the roster row, not the Select's <span>.

const TABLE_SAW = { id: 1, name: "Table Saw", safetyGuide: null, _count: { toolStatuses: 2 } };
const LASER = { id: 2, name: "Laser Cutter", safetyGuide: "https://example.com/guide", _count: { toolStatuses: 0 } };
const MEMBERS = [
  { id: 10, name: "Alice", email: "alice@example.com" },
  { id: 11, name: "Bob", email: "bob@example.com" },
];

beforeEach(() => resetRtl());

describe("ToolManagementPanel", () => {
  it("loads and renders the tool list", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/shop/tools": [TABLE_SAW, LASER],
      "/api/shop/members": { members: MEMBERS },
    });
    renderWithProviders(<ToolManagementPanel />);

    expect(await screen.findByText("Table Saw")).toBeInTheDocument();
    expect(screen.getByText("Laser Cutter")).toBeInTheDocument();
    expect(screen.getByText("2 certified")).toBeInTheDocument();
  });

  it("expanding a tool fetches and shows its certified-members roster", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/shop/certifications?toolId=1": [
        { participantId: 10, toolId: 1, level: "CERTIFIED", participant: { id: 10, name: "Alice" } },
      ],
      "/api/shop/tools": [TABLE_SAW],
      "/api/shop/members": { members: MEMBERS },
    });
    renderWithProviders(<ToolManagementPanel />);

    fireEvent.click(await screen.findByText("Table Saw"));

    expect(await screen.findByText("Alice", { selector: "p" })).toBeInTheDocument();
  });

  it("edits a tool's safety guide URL (PATCH) and shows the success message", async () => {
    // Single tool in the list: ToolsTab's certs Collapse content stays mounted
    // (just visually hidden) for every card, so a second tool here would make
    // "Edit guide" ambiguous.
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({
      "/api/shop/tools/1": { success: true, tool: { ...TABLE_SAW, safetyGuide: "https://new.example.com" } },
      "/api/shop/tools": [TABLE_SAW],
      "/api/shop/members": { members: MEMBERS },
    });
    renderWithProviders(<ToolManagementPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit guide" }));
    // Modal mounts a tick after the click (Mantine portal), not synchronously.
    fireEvent.change(await screen.findByPlaceholderText("https://..."), { target: { value: "https://new.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/shop/tools/1", expect.objectContaining({ method: "PATCH" }));
    });
    expect(await screen.findByText("Safety guide updated.")).toBeInTheDocument();
  });

  it("By Person tab: lists members and loads a member's certifications on expand", async () => {
    // Single member: same shared-Collapse-content reasoning as the tool list above.
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/shop/certifications?participantId=10": [
        { participantId: 10, toolId: 1, level: "CERTIFIED", tool: { id: 1, name: "Table Saw" } },
      ],
      "/api/shop/tools": [TABLE_SAW],
      "/api/shop/members": { members: [MEMBERS[0]] },
    });
    renderWithProviders(<ToolManagementPanel />);

    fireEvent.click(await screen.findByRole("tab", { name: "By Person" }));
    fireEvent.click(await screen.findByText("Alice"));

    expect(await screen.findByText("Table Saw", { selector: "p" })).toBeInTheDocument();
  });

  it("All Assignments tab: renders the person x tool matrix from ?all=true", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/shop/certifications?all=true": [
        {
          participantId: 10,
          toolId: 1,
          level: "CERTIFIED",
          participant: { id: 10, name: "Alice" },
          tool: { id: 1, name: "Table Saw" },
        },
      ],
      "/api/shop/tools": [TABLE_SAW],
      "/api/shop/members": { members: MEMBERS },
    });
    renderWithProviders(<ToolManagementPanel />);

    fireEvent.click(await screen.findByRole("tab", { name: "All Assignments" }));

    expect(await screen.findByText("1 assignment")).toBeInTheDocument();
  });
});
