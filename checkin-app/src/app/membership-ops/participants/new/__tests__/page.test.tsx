// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, setSearchParams, resetRtl } from "@/test-helpers/rtl";
import NewParticipantPage from "../page";

beforeEach(() => resetRtl());

describe("membership-ops/participants/new page", () => {
  it("renders the registration form", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({});
    renderWithProviders(<NewParticipantPage />);

    expect(await screen.findByText("Register New User")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Participant" })).toBeDisabled();
  });

  it("submits a new adult participant", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({
      "/api/membership-ops/participants": { participant: { email: "jane@example.com" } },
    });
    renderWithProviders(<NewParticipantPage />);
    await screen.findByText("Register New User");

    fireEvent.change(screen.getByPlaceholderText("e.g. Jane Doe"), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByPlaceholderText("jane.doe@example.com"), { target: { value: "jane@example.com" } });

    const submitBtn = screen.getByRole("button", { name: "Create Participant" });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/membership-ops/participants",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "Jane Doe",
            email: "jane@example.com",
            parentEmail: null,
            dob: null,
            householdId: null,
            alreadyMember: false,
          }),
        }),
      ),
    );
    expect(await screen.findByText("Participant Jane Doe successfully!")).toBeInTheDocument();
  });

  it("requires a parent email once a student DOB is entered", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({});
    renderWithProviders(<NewParticipantPage />);
    await screen.findByText("Register New User");

    fireEvent.change(screen.getByLabelText("Date of Birth"), { target: { value: "2015-01-01" } });

    expect(await screen.findByText("Student Detected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Participant" })).toBeDisabled();
  });

  it("prefills the household from a deep-linked householdId", async () => {
    setSession({ id: 1, isSysadmin: true });
    setSearchParams("householdId=5");
    mockFetchJson({
      "/api/membership-ops/households?id=5": { household: { id: 5, name: "The Smiths" } },
    });
    renderWithProviders(<NewParticipantPage />);

    expect(await screen.findByDisplayValue("The Smiths")).toBeInTheDocument();
  });
});
