// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("qrcode", () => ({ toDataURL: jest.fn(async () => "data:image/png;base64,QR") }));
// @react-pdf/renderer is pure ESM/non-DOM (see BadgeDocument.test.tsx); swap its
// primitives for DOM stand-ins and stub `pdf().toBlob()` so the "Generate" flow
// (which renders BadgeDocument/StickerDocument through it) runs under RTL/jsdom.
jest.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Page: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  // eslint-disable-next-line @next/next/no-img-element -- test stand-in, not app UI
  Image: ({ src }: { src?: string }) => <img alt="" src={src} />,
  StyleSheet: { create: (styles: unknown) => styles },
  Font: { register: jest.fn() },
  pdf: jest.fn(() => ({ toBlob: async () => new Blob(["pdf"], { type: "application/pdf" }) })),
}));

import type { ReactNode } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import PrintBadgesPage from "../page";

beforeEach(() => {
  resetRtl();
  // jsdom doesn't implement the object-URL APIs the download flow uses.
  global.URL.createObjectURL = jest.fn(() => "blob:test");
  global.URL.revokeObjectURL = jest.fn();
});

const participants = [
  { id: 1, name: "Kim Keyholder", email: "kim@example.com", isMember: true, isKeyholder: true },
  { id: 2, name: "Bo Board", email: "bo@example.com", isMember: true, isBoardMember: true },
];

const withInactive = [
  participants[0],
  { id: 3, name: "Lapsed Larry", email: "larry@example.com", isMember: false },
];

// The active membership — wider than what the search returns, and the only thing badge names
// may depend on. Kim Kowalski is a member who is NOT in the search results above.
const orgMembers = [
  { id: 1, name: "Kim Keyholder" },
  { id: 2, name: "Bo Board" },
  { id: 4, name: "Kim Kowalski" },
];

describe("facility-ops/print-badges page", () => {
  it("loads and renders the participant roster", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/people/search": { people: participants }, "/api/shop/org-members": { orgMembers } });
    renderWithProviders(<PrintBadgesPage />);

    expect(await screen.findByText("Kim Keyholder")).toBeInTheDocument();
    expect(screen.getByText("Bo Board")).toBeInTheDocument();
    expect(screen.getByText("KEYHOLDER")).toBeInTheDocument();
    expect(screen.getByText("BOARD")).toBeInTheDocument();
  });

  it("re-searches participants as the search box changes", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/people/search": { people: participants }, "/api/shop/org-members": { orgMembers } });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("Kim Keyholder");

    fireEvent.change(screen.getByPlaceholderText("Search by name or email..."), { target: { value: "Kim" } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("q=Kim")),
    );
  });

  it("shows the badge name resolved against the whole active membership, not the listed rows", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/people/search": { people: participants }, "/api/shop/org-members": { orgMembers } });
    renderWithProviders(<PrintBadgesPage />);

    // Kim collides with Kim Kowalski, who is a member but not on screen — the badge still needs
    // the last initial. Bo is unique in the membership, so a bare first name.
    expect(await screen.findByText("Kim Ke.")).toBeInTheDocument();
    expect(screen.getByText("Bo")).toBeInTheDocument();
  });

  it("holds badge generation until the member roster has loaded", async () => {
    setSession({ id: 1, isSysadmin: true });
    // No org-members route: the roster never resolves, so a badge would carry an unresolved name.
    // The page logs that failure, which jest-fail-on-console would otherwise treat as a defect.
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetchJson({ "/api/people/search": { people: participants } });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("Kim Keyholder");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Generate Badge (2)" })).toBeDisabled();
    await waitFor(() => expect(logged).toHaveBeenCalled());
    logged.mockRestore();
  });

  it("selects participants and generates a badge PDF", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/people/search": { people: participants }, "/api/shop/org-members": { orgMembers } });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("Kim Keyholder");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Generate Badge (2)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate Badge (2)" }));

    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
  });

  it("hides inactive people by default and reveals them when unchecked", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/people/search": { people: withInactive }, "/api/shop/org-members": { orgMembers } });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("Kim Keyholder");

    const filter = screen.getByRole("checkbox", { name: /hide inactive/i });
    expect(filter).toBeChecked();
    expect(screen.queryByText("Lapsed Larry")).not.toBeInTheDocument();

    fireEvent.click(filter);
    expect(await screen.findByText("Lapsed Larry")).toBeInTheDocument();
  });

  it("drops hidden people from the selection count, so the PDF matches the button", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/people/search": { people: withInactive }, "/api/shop/org-members": { orgMembers } });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("Kim Keyholder");

    const filter = screen.getByRole("checkbox", { name: /hide inactive/i });
    fireEvent.click(filter); // reveal the inactive person
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Generate Badge (2)" })).toBeInTheDocument();

    fireEvent.click(filter); // hide again — the inactive person must leave the print run
    expect(screen.getByRole("button", { name: "Generate Badge (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Sticker (1)" })).toBeInTheDocument();
    // and "select all" still reads as fully selected over what is actually visible
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBeChecked();
  });
});
