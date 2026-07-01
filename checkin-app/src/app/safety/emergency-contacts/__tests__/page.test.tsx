// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import EmergencyContactsPage from "../page";

beforeEach(() => resetRtl());

const households = [
  {
    id: 1,
    name: "Keyholder House",
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContacts: [{ id: 11, name: "Gary Guardian", phone: "5551234567", email: "gary@example.com", relationship: "Uncle", invalid: false }],
    isPresent: true,
    participants: [{ id: 101, name: "Kid Keyholder", isPresent: true }],
    leads: [{ id: 201, name: "Lea Lead", phone: "5559876543", email: "lea@example.com" }],
  },
  {
    id: 2,
    name: "Away House",
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContacts: [],
    isPresent: false,
    participants: [],
    leads: [],
  },
];

describe("safety/emergency-contacts page", () => {
  it("loads and renders households, pinning present ones first", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/safety/emergency-contacts": { households } });
    renderWithProviders(<EmergencyContactsPage />);

    expect(await screen.findByText("Keyholder House")).toBeInTheDocument();
    expect(screen.getByText("Away House")).toBeInTheDocument();
    expect(screen.getByText("Present Now")).toBeInTheDocument();
    expect(screen.getByText("Kid Keyholder")).toBeInTheDocument();
    expect(screen.getByText("Lea Lead")).toBeInTheDocument();
    expect(screen.getByText("Gary Guardian (Uncle)")).toBeInTheDocument();
    expect(screen.getByText("No designated leads found.")).toBeInTheDocument();
    expect(screen.getByText("Not Configured")).toBeInTheDocument();
  });

  it("filters households by search query", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/safety/emergency-contacts": { households } });
    renderWithProviders(<EmergencyContactsPage />);
    await screen.findByText("Keyholder House");

    fireEvent.change(screen.getByPlaceholderText("Search by Household Name, Parent Name, or Member Name..."), {
      target: { value: "Away" },
    });

    expect(screen.getByText("Away House")).toBeInTheDocument();
    expect(screen.queryByText("Keyholder House")).not.toBeInTheDocument();
  });

  it("shows an error state when the fetch fails", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({});
    renderWithProviders(<EmergencyContactsPage />);

    expect(await screen.findByText(/Failed to load emergency contacts/)).toBeInTheDocument();
  });
});
