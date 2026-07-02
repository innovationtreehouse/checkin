// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl, resolvedParams } from "@/test-helpers/rtl";
import PublicRegistrationPage from "../page";

beforeEach(() => resetRtl());

const program = {
  name: "Robotics Club",
  nonMemberPriceCents: 5000,
  minAge: null,
  maxAge: null,
  enrollmentStatus: "OPEN",
  maxParticipants: null,
  _count: { participants: 2 },
};

function renderPage() {
  return renderWithProviders(<PublicRegistrationPage params={resolvedParams({ id: "1" })} />);
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
    expect(await screen.findByText("Primary parent/guardian information is required.")).toBeInTheDocument();
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
});
