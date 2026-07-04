// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl, resolvedParams, router } from "@/test-helpers/rtl";
import { notifications } from "@mantine/notifications";
import PublicRegistrationPage from "../page";

beforeEach(() => { resetRtl(); (notifications.show as jest.Mock).mockClear(); });

const program = {
  name: "Robotics Club",
  nonOrgMemberPriceCents: 5000,
  minAge: null,
  maxAge: null,
  enrollmentStatus: "OPEN",
  maxParticipants: null,
  _count: { participants: 2 },
};

function renderPage() {
  return renderWithProviders(<PublicRegistrationPage params={resolvedParams({ id: "1" })} />);
}

// Fills the primary guardian + emergency contact required fields shared by most
// validateForm/handleSubmit tests below (participant name/DOB are left to the caller).
function fillGuardianAndEmergencyContact(phone = "5125551234") {
  fireEvent.change(screen.getAllByLabelText("Full Name", { exact: false })[0], { target: { value: "Jane Doe" } });
  fireEvent.change(screen.getByLabelText("Email Address", { exact: false }), { target: { value: "jane@example.com" } });
  fireEvent.change(screen.getAllByLabelText("Phone Number", { exact: false })[0], { target: { value: phone } });
  fireEvent.change(screen.getByLabelText("Contact Name", { exact: false }), { target: { value: "John Smith" } });
  fireEvent.change(screen.getByLabelText("Contact Phone", { exact: false }), { target: { value: "5125559999" } });
}

describe("PublicRegistrationPage", () => {
  it("loads the program and blocks submit until required fields are filled", async () => {
    mockFetchJson({ "/api/programs/1": program });
    renderPage();

    expect(await screen.findByText("Robotics Club")).toBeInTheDocument();
    // fireEvent.click would trip jsdom's native required-field validation and never
    // reach the submit handler; dispatch the submit event directly to bypass it.
    const form = screen.getByRole("button", { name: "Pay & Register via Shopify" }).closest("form")!;
    fireEvent.submit(form);
    // All five required fields (parent name/email/phone + EC name/phone) now
    // render an inline "Required" beneath the input instead of one banner.
    expect(await screen.findAllByText("Required")).toHaveLength(5);
  });

  it("submits a fully filled-out registration", async () => {
    const fetchMock = mockFetchJson({
      "/api/programs/1/public-register": { checkoutUrl: null },
      "/api/programs/1": program,
    });
    renderPage();
    await screen.findByText("Robotics Club");

    // Required fields render a trailing " *" inside the <label>, so match loosely.
    fireEvent.change(screen.getAllByLabelText("Full Name", { exact: false })[0], { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByLabelText("Email Address", { exact: false }), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getAllByLabelText("Phone Number", { exact: false })[0], { target: { value: "5125551234" } });
    fireEvent.change(screen.getByLabelText("Contact Name", { exact: false }), { target: { value: "John Smith" } });
    fireEvent.change(screen.getByLabelText("Contact Phone", { exact: false }), { target: { value: "5125559999" } });

    // matches parent name -> DOB not required
    fireEvent.change(screen.getAllByLabelText("Full Name", { exact: false })[1], { target: { value: "Jane Doe" } });

    fireEvent.click(screen.getByRole("button", { name: "Pay & Register via Shopify" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/programs/1/public-register",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows an error state when the program fails to load", async () => {
    mockFetchJson({});
    renderPage();
    expect(await screen.findByText("Failed to load program details.")).toBeInTheDocument();
  });

  it("adds and removes a secondary guardian", async () => {
    mockFetchJson({ "/api/programs/1": program });
    renderPage();
    await screen.findByText("Robotics Club");

    fireEvent.click(screen.getByRole("button", { name: "+ Add Secondary Guardian" }));
    expect(screen.getByText("Secondary Guardian (Optional)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add Secondary Guardian" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Secondary Guardian (Optional)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add Secondary Guardian" })).toBeInTheDocument();
  });

  it("adds an extra participant, updates the price multiplier, sets a DOB, then removes a participant", async () => {
    mockFetchJson({ "/api/programs/1": program });
    renderPage();
    await screen.findByText("Robotics Club");

    fireEvent.click(screen.getByRole("button", { name: "+ Add Another Participant" }));
    expect(screen.getByText("Participant 2")).toBeInTheDocument();
    expect(screen.getByText(/× 2/)).toBeInTheDocument();

    const dobInputs = screen.getAllByLabelText("Date of Birth", { exact: false });
    fireEvent.change(dobInputs[1], { target: { value: "2010-01-01" } });
    expect(dobInputs[1]).toHaveValue("2010-01-01");

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.queryByText("Participant 2")).not.toBeInTheDocument();
    expect(screen.queryByText(/× 2/)).not.toBeInTheDocument();
  });

  it("requires an emergency contact before checking anything else", async () => {
    mockFetchJson({ "/api/programs/1": program });
    renderPage();
    await screen.findByText("Robotics Club");
    fireEvent.change(screen.getAllByLabelText("Full Name", { exact: false })[0], { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByLabelText("Email Address", { exact: false }), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getAllByLabelText("Phone Number", { exact: false })[0], { target: { value: "5125551234" } });

    const form = screen.getByRole("button", { name: "Pay & Register via Shopify" }).closest("form")!;
    fireEvent.submit(form);
    // Parent fields filled; only the two EC fields flag "Required" inline.
    expect(await screen.findAllByText("Required")).toHaveLength(2);
  });

  it("rejects an emergency contact phone that matches a parent's phone", async () => {
    mockFetchJson({ "/api/programs/1": program });
    renderPage();
    await screen.findByText("Robotics Club");
    fillGuardianAndEmergencyContact("5125559999");
    fireEvent.change(screen.getAllByLabelText("Full Name", { exact: false })[1], { target: { value: "Kid Doe" } });

    fireEvent.click(screen.getByRole("button", { name: "Pay & Register via Shopify" }));
    expect(
      await screen.findByText("Must differ from parent/guardian phone"),
    ).toBeInTheDocument();
  });

  it("requires a participant name", async () => {
    mockFetchJson({ "/api/programs/1": program });
    renderPage();
    await screen.findByText("Robotics Club");
    fillGuardianAndEmergencyContact();

    const form = screen.getByRole("button", { name: "Pay & Register via Shopify" }).closest("form")!;
    fireEvent.submit(form);
    expect(await screen.findByText("Required")).toBeInTheDocument();
  });

  it("requires a Date of Birth for age-restricted programs unless the participant matches a parent's name", async () => {
    const fetchMock = mockFetchJson({
      "/api/programs/1/public-register": { checkoutUrl: null },
      "/api/programs/1": { ...program, minAge: 5, maxAge: 18 },
    });
    renderPage();
    await screen.findByText("Robotics Club");
    fillGuardianAndEmergencyContact();
    fireEvent.change(screen.getAllByLabelText("Full Name", { exact: false })[1], { target: { value: "Kid Doe" } });

    const form = screen.getByRole("button", { name: "Pay & Register via Shopify" }).closest("form")!;
    fireEvent.submit(form);
    expect(await screen.findByText("Date of birth required for age verification")).toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText("Date of Birth", { exact: false })[0], { target: { value: "2015-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay & Register via Shopify" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/programs/1/public-register", expect.objectContaining({ method: "POST" })),
    );
  });

  it("redirects to Shopify checkout when registration returns a checkout URL", async () => {
    mockFetchJson({
      "/api/programs/1/public-register": { checkoutUrl: "https://shop.example.com/checkout" },
      "/api/programs/1": program,
    });
    renderPage();
    await screen.findByText("Robotics Club");
    fillGuardianAndEmergencyContact();
    fireEvent.change(screen.getAllByLabelText("Full Name", { exact: false })[1], { target: { value: "Jane Doe" } });

    fireEvent.click(screen.getByRole("button", { name: "Pay & Register via Shopify" }));
    expect(await screen.findByText("Registration started! Redirecting you to checkout...")).toBeInTheDocument();
  });

  it("shows a server error message when registration fails", async () => {
    mockFetchJson({ "/api/programs/1": program });
    renderPage();
    await screen.findByText("Robotics Club");
    fillGuardianAndEmergencyContact();
    fireEvent.change(screen.getAllByLabelText("Full Name", { exact: false })[1], { target: { value: "Jane Doe" } });

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "That email is already registered." }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: "Pay & Register via Shopify" }));
    expect(await screen.findByText("That email is already registered.")).toBeInTheDocument();
  });

  it("shows a network-error message when registration throws", async () => {
    mockFetchJson({ "/api/programs/1": program });
    renderPage();
    await screen.findByText("Robotics Club");
    fillGuardianAndEmergencyContact();
    fireEvent.change(screen.getAllByLabelText("Full Name", { exact: false })[1], { target: { value: "Jane Doe" } });

    global.fetch = jest.fn().mockRejectedValue(new Error("down"));
    fireEvent.click(screen.getByRole("button", { name: "Pay & Register via Shopify" }));
    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ color: "red", message: "Network error occurred.", autoClose: false }),
      ),
    );
  });

  it("navigates back to the program from the Cancel button", async () => {
    mockFetchJson({ "/api/programs/1": program });
    renderPage();
    await screen.findByText("Robotics Club");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(router.push).toHaveBeenCalledWith("/programs/1");
  });

  it("shows Complete Registration (no Shopify cost line) for a free program", async () => {
    mockFetchJson({ "/api/programs/1": { ...program, nonOrgMemberPriceCents: null } });
    renderPage();
    expect(await screen.findByText("Complete Registration")).toBeInTheDocument();
  });

  it("navigates back to the program from the Go Back button on a load error", async () => {
    mockFetchJson({});
    renderPage();
    expect(await screen.findByText("Failed to load program details.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go Back" }));
    expect(router.push).toHaveBeenCalledWith("/programs/1");
  });

  it("blocks registration when the program is closed", async () => {
    mockFetchJson({ "/api/programs/1": { ...program, enrollmentStatus: "CLOSED" } });
    renderPage();
    expect(await screen.findByText("Registration is currently closed for this program.")).toBeInTheDocument();
  });

  it("blocks registration when the program is full", async () => {
    mockFetchJson({ "/api/programs/1": { ...program, maxParticipants: 2, _count: { participants: 2 } } });
    renderPage();
    expect(await screen.findByText("This program is currently full.")).toBeInTheDocument();
  });

  it("shows a network-error message when the program fetch throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("down"));
    renderPage();
    expect(await screen.findByText("Network error.")).toBeInTheDocument();
  });
});
