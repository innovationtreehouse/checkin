// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import MembershipPage from "../page";

beforeEach(() => resetRtl());

const emptyPrefill = { household: null, primaryParent: null, secondaryParent: null, children: [] };

function state(overrides: Record<string, unknown>) {
  return {
    hasHousehold: false,
    membershipStatus: null,
    process: null,
    external: null,
    prefill: emptyPrefill,
    ...overrides,
  };
}

describe("membership page", () => {
  it("prompts sign-in when unauthenticated", async () => {
    renderWithProviders(<MembershipPage />);
    expect(await screen.findByText("Join the Treehouse")).toBeInTheDocument();
  });

  it("shows the active-member card when there's no process and membership is active", async () => {
    setSession({ id: 1 });
    mockFetchJson({ "/api/membership": state({ membershipStatus: "ACTIVE" }) });
    renderWithProviders(<MembershipPage />);

    expect(await screen.findByText("You're a member 🎉", { exact: false })).toBeInTheDocument();
  });

  it("starts an application from the become-a-member card", async () => {
    setSession({ id: 1 });
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ state: state({ process: { id: 1, kind: "INITIAL", status: "INTAKE" } }) }) } as Response;
      }
      return { ok: true, json: async () => state({}) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderWithProviders(<MembershipPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Start application" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/membership", expect.objectContaining({ method: "POST" })),
    );
    expect(await screen.findByText("Your household")).toBeInTheDocument();
  });

  it("fills the intake form and saves progress", async () => {
    setSession({ id: 1 });
    const fetchMock = mockFetchJson({
      "/api/membership/intake": { state: state({ process: { id: 1, kind: "INITIAL", status: "INTAKE" } }), rejections: [] },
      "/api/membership": state({ process: { id: 1, kind: "INITIAL", status: "INTAKE" } }),
    });
    renderWithProviders(<MembershipPage />);
    await screen.findByText("Your household");

    fireEvent.change(screen.getByPlaceholderText("123 Main St"), { target: { value: "1 Treehouse Ln" } });
    fireEvent.change(screen.getByLabelText("Emergency contact name"), { target: { value: "Aunt Jo" } });
    fireEvent.change(screen.getByLabelText("Emergency contact phone"), { target: { value: "555-1234" } });
    fireEvent.change(screen.getByLabelText("Full name", { exact: false }), { target: { value: "Pat Parent" } });

    fireEvent.click(screen.getByRole("button", { name: "Save progress" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/membership/intake", expect.objectContaining({ method: "PATCH" })),
    );
    expect(await screen.findByText("Progress saved.")).toBeInTheDocument();
  });

  it("submits the intake form and advances to the next step", async () => {
    setSession({ id: 1 });
    const fetchMock = mockFetchJson({
      "/api/membership/intake/submit": { state: state({ process: { id: 1, kind: "INITIAL", status: "PENDING_EXTERNAL_ACTION" }, external: { contractSigned: false, contractStarted: false, bgConsented: false, bgCleared: false, deepLinkUrl: null } }) },
      "/api/membership/intake": { state: state({ process: { id: 1, kind: "INITIAL", status: "INTAKE" } }), rejections: [] },
      "/api/membership": state({ process: { id: 1, kind: "INITIAL", status: "INTAKE" } }),
    });
    renderWithProviders(<MembershipPage />);
    await screen.findByText("Your household");

    fireEvent.change(screen.getByPlaceholderText("123 Main St"), { target: { value: "1 Treehouse Ln" } });
    fireEvent.change(screen.getByLabelText("Emergency contact name"), { target: { value: "Aunt Jo" } });
    fireEvent.change(screen.getByLabelText("Emergency contact phone"), { target: { value: "555-1234" } });
    fireEvent.change(screen.getByLabelText("Full name", { exact: false }), { target: { value: "Pat Parent" } });

    fireEvent.click(screen.getByRole("button", { name: "Submit & continue" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/membership/intake/submit", expect.objectContaining({ method: "POST" })),
    );
    expect(await screen.findByText("Sign & start your background check", { exact: false })).toBeInTheDocument();
  });

  it("renders PENDING_EXTERNAL_ACTION and starts signing", async () => {
    setSession({ id: 1 });
    const fetchMock = mockFetchJson({
      "/api/membership/contract/sign": { url: "https://sign.example/doc" },
      "/api/membership": state({
        process: { id: 1, kind: "INITIAL", status: "PENDING_EXTERNAL_ACTION" },
        external: { contractSigned: false, contractStarted: false, bgConsented: false, bgCleared: false, deepLinkUrl: "https://averity.example/consent" },
      }),
    });
    renderWithProviders(<MembershipPage />);
    await screen.findByText("Sign & start your background check", { exact: false });

    expect(screen.getByRole("link", { name: /Consent on Averity/ })).toHaveAttribute("href", "https://averity.example/consent");

    fireEvent.click(screen.getByRole("button", { name: /Sign your membership agreement/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/membership/contract/sign", expect.objectContaining({ method: "POST" })),
    );
  });

  it("renders PENDING_EXTERNAL_ACTION with a cleared background check", async () => {
    setSession({ id: 1 });
    mockFetchJson({
      "/api/membership": state({
        process: { id: 1, kind: "INITIAL", status: "PENDING_EXTERNAL_ACTION" },
        external: { contractSigned: true, contractStarted: true, bgConsented: false, bgCleared: true, deepLinkUrl: null },
      }),
    });
    renderWithProviders(<MembershipPage />);

    expect(await screen.findByText("Agreement signed — thank you!")).toBeInTheDocument();
    expect(screen.getByText("Background check")).toBeInTheDocument();
  });

  it("renders PENDING_PAYMENT with a checkout link", async () => {
    setSession({ id: 1 });
    mockFetchJson({
      "/api/membership/payment": { amountCents: 12500, checkoutUrl: "https://shop.example/checkout" },
      "/api/membership": state({ process: { id: 1, kind: "INITIAL", status: "PENDING_PAYMENT" }, external: { contractSigned: true, contractStarted: true, bgConsented: true, bgCleared: false, deepLinkUrl: null } }),
    });
    renderWithProviders(<MembershipPage />);

    expect(await screen.findByText("$125.00", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pay here with Shopify/ })).toHaveAttribute("href", "https://shop.example/checkout");
  });

  it("renders PENDING_BG_CLEARANCE", async () => {
    setSession({ id: 1 });
    mockFetchJson({ "/api/membership": state({ process: { id: 1, kind: "INITIAL", status: "PENDING_BG_CLEARANCE" } }) });
    renderWithProviders(<MembershipPage />);

    expect(await screen.findByText("Payment received 🎉", { exact: false })).toBeInTheDocument();
  });

  it("renders the default in-progress card for other statuses", async () => {
    setSession({ id: 1 });
    mockFetchJson({ "/api/membership": state({ process: { id: 1, kind: "INITIAL", status: "PENDING_BG_REVIEW" } }) });
    renderWithProviders(<MembershipPage />);

    expect(await screen.findByText("Application in progress")).toBeInTheDocument();
  });

  it("renders the renewal prompt and starts a renewal", async () => {
    setSession({ id: 1 });
    const fetchMock = mockFetchJson({
      "/api/membership/renew": { ok: true },
      "/api/membership": state({ process: { id: 1, kind: "RENEWAL", status: "PENDING_RENEWAL" } }),
    });
    renderWithProviders(<MembershipPage />);
    await screen.findByText("Time to renew");

    fireEvent.click(screen.getByRole("button", { name: "Renew now" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/membership/renew", expect.objectContaining({ method: "POST" })),
    );
  });

  it("renders the renewal-pending-background-check state", async () => {
    setSession({ id: 1 });
    mockFetchJson({ "/api/membership": state({ process: { id: 1, kind: "RENEWAL", status: "RENEWAL_PENDING_BG" } }) });
    renderWithProviders(<MembershipPage />);

    expect(await screen.findByText("Renewal in progress")).toBeInTheDocument();
  });
});
