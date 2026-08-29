// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("qrcode", () => ({ toDataURL: jest.fn(async () => "data:image/png;base64,QR") }));
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));
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
import { notifications } from "@mantine/notifications";
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

// Two ACTIVE members whose first names collide. `?roster=active` is keyed first so it
// wins mockFetchJson's substring match over the plain search URL.
const johns = [
  { id: 1, name: "John Smith", email: "js@example.com", isMember: true },
  { id: 2, name: "John Doe", email: "jd@example.com", isMember: true },
];
// Smith settled this renewal cycle; Doe is ACTIVE but has not — nothing revokes a
// membership at the boundary, so both are on the roster and only one has earned a year.
const johnRoster = [
  { id: 1, name: "John Smith", year: "2026-2027" },
  { id: 2, name: "John Doe", year: null },
];
const johnRoutes = {
  "/api/people/search?roster=active": { people: johnRoster },
  "/api/people/search": { people: johns },
};
const cell = (fullName: string, index: number) =>
  screen.getByText(fullName).closest("tr")!.querySelectorAll("td")[index].textContent;
const printedNameCell = (fullName: string) => cell(fullName, 4);
const yearCell = (fullName: string) => cell(fullName, 6);
const nicknameBox = (fullName: string) =>
  screen.getByRole("textbox", { name: `Nickname for ${fullName}` });

describe("facility-ops/print-badges page", () => {
  it("loads and renders the participant roster", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/people/search": { people: participants } });
    renderWithProviders(<PrintBadgesPage />);

    expect(await screen.findByText("Kim Keyholder")).toBeInTheDocument();
    expect(screen.getByText("Bo Board")).toBeInTheDocument();
    expect(screen.getByText("KEYHOLDER")).toBeInTheDocument();
    expect(screen.getByText("BOARD")).toBeInTheDocument();
  });

  it("re-searches participants as the search box changes", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/people/search": { people: participants } });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("Kim Keyholder");

    fireEvent.change(screen.getByPlaceholderText("Search by name, email, or ID..."), { target: { value: "Kim" } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("q=Kim")),
    );
  });

  it("selects participants and generates a badge PDF", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/people/search": { people: participants } });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("Kim Keyholder");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Generate Badge (2)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate Badge (2)" }));

    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
  });

  it("hides inactive people by default and reveals them when unchecked", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/people/search": { people: withInactive } });
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
    mockFetchJson({ "/api/people/search": { people: withInactive } });
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

  // #1625. The Printed Name column exists so this pair of assertions is writable at all:
  // it is the only place the value the badge will print is observable without generating
  // a PDF. Both were red against the old behaviour, where the name was computed over the
  // current print batch inside BadgeDocument.
  it("keeps the printed name fixed to the ACTIVE roster, not the current selection", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson(johnRoutes);
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("John Smith");

    // Two ACTIVE Johns on the roster, so Smith prints disambiguated — with nothing ticked.
    await waitFor(() => expect(printedNameCell("John Smith")).toBe("John S."));
    expect(printedNameCell("John Doe")).toBe("John D.");

    // Tick only Smith: he is now the entire print batch. His name must not move.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    expect(screen.getByRole("button", { name: "Generate Badge (1)" })).toBeInTheDocument();
    expect(printedNameCell("John Smith")).toBe("John S.");
    // Headroom over rtl's 5s asyncUtilTimeout, so a failing waitFor reports its own
    // assertion diff instead of being cut off by jest's equal-length test timeout.
  }, 15000);

  // #1628. Both Johns are ACTIVE members, so "is a member" cannot be what decides this —
  // only settling the current renewal cycle can. The column is the operator's warning
  // that a blank badge is coming, before the sheet is in the printer.
  it("shows the membership year only for a household that settled this cycle", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson(johnRoutes);
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("John Smith");

    await waitFor(() => expect(yearCell("John Smith")).toBe("2026-2027"));
    expect(yearCell("John Doe")).toBe("Not renewed");
  }, 15000);

  // Filter-by-year is off by default so an ACTIVE-but-not-renewed household keeps its
  // "Not renewed" row (the renewal prompt). Turning it on drops that row, leaving only
  // households that settled the selected cycle.
  it("filters the list to the selected year only when the box is checked", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/people/search?roster=years": { years: ["2026-2027"], current: "2026-2027" },
      ...johnRoutes,
    });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("John Smith");
    await waitFor(() => expect(yearCell("John Smith")).toBe("2026-2027"));

    // Off by default: the not-renewed John is still visible.
    const filter = screen.getByRole("checkbox", { name: /filter by year/i });
    expect(filter).not.toBeChecked();
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // On: only the household that settled 2026-2027 remains.
    fireEvent.click(filter);
    await waitFor(() => expect(screen.queryByText("John Doe")).not.toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    // "Hide inactive (N)" counts only inactive rows, never the year-filtered ones.
    expect(screen.getByRole("checkbox", { name: /^hide inactive$/i })).toBeInTheDocument();
  }, 15000);

  it("keeps the printed name fixed when the search box narrows the visible rows", async () => {
    setSession({ id: 1, isSysadmin: true });
    const searchResults = { current: johns };
    mockFetchJson({
      "/api/people/search?roster=active": { people: johnRoster },
      "/api/people/search": () => ({ people: searchResults.current }),
    });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("John Smith");
    await waitFor(() => expect(printedNameCell("John Smith")).toBe("John S."));

    // Search away the other John. He is still an ACTIVE member, so Smith stays "John S.".
    searchResults.current = [johns[0]];
    fireEvent.change(screen.getByPlaceholderText("Search by name, email, or ID..."), { target: { value: "Smi" } });

    // Settle on the narrowed table — mid-fetch the DataTable shows a spinner and no rows.
    await waitFor(() => {
      expect(screen.getByText("John Smith")).toBeInTheDocument();
      expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
    });
    expect(printedNameCell("John Smith")).toBe("John S.");
  }, 15000);

  // #1651. Off-roster people get a bare first name — no disambiguation among themselves.
  // This is stable across search-box changes (the old behaviour ran computeDisplayNames
  // over the search results, so names shifted when the query changed).
  it("gives off-roster people a bare first name, without moving a member's name", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/people/search?roster=active": { people: [{ id: 1, name: "John Smith", year: null }] },
      "/api/people/search": {
        people: [
          { id: 1, name: "John Smith", email: "js@example.com", isMember: true },
          { id: 8, name: "John Nonmember", email: "jn@example.com", isMember: false },
          { id: 9, name: "John Guest", email: "jg@example.com", isMember: false },
        ],
      },
    });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("John Smith");
    fireEvent.click(screen.getByRole("checkbox", { name: /hide inactive/i }));

    // Both off-roster Johns get bare "John" — no disambiguation, but stable across queries.
    await waitFor(() => expect(printedNameCell("John Nonmember")).toBe("John"));
    expect(printedNameCell("John Guest")).toBe("John");
    // The only John on the ACTIVE roster, so his name is unqualified — the two off-roster
    // Johns are not in that population and must not pull him to "John S.".
    expect(printedNameCell("John Smith")).toBe("John");
  }, 15000);

  // #1651. The old code ran computeDisplayNames over the search results for off-roster
  // people, so narrowing the search could change an off-roster person's badge name.
  it("keeps off-roster badge names stable when the search box narrows", async () => {
    setSession({ id: 1, isSysadmin: true });
    const offRosterPeople = [
      { id: 8, name: "John Nonmember", email: "jn@example.com", isMember: false },
      { id: 9, name: "John Guest", email: "jg@example.com", isMember: false },
    ];
    const searchResults = { current: offRosterPeople };
    mockFetchJson({
      "/api/people/search?roster=active": { people: [] },
      "/api/people/search": () => ({ people: searchResults.current }),
    });
    renderWithProviders(<PrintBadgesPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /hide inactive/i }));
    await screen.findByText("John Nonmember");

    const nameBefore = printedNameCell("John Nonmember");

    // Narrow to just one off-roster John.
    searchResults.current = [offRosterPeople[0]];
    fireEvent.change(screen.getByPlaceholderText("Search by name, email, or ID..."), { target: { value: "Nonmember" } });
    await waitFor(() => {
      expect(screen.getByText("John Nonmember")).toBeInTheDocument();
      expect(screen.queryByText("John Guest")).not.toBeInTheDocument();
    });

    expect(printedNameCell("John Nonmember")).toBe(nameBefore);
  }, 15000);

  // The nickname box is the zero-click edit: no button, no modal, and the Printed
  // Name column has to follow the save or it stops being proof of what will print.
  it("saves a typed nickname and reprints the name around it", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({
      ...johnRoutes,
      "/api/people/1/nickname": { person: { id: 1, name: "John Smith", nickname: "Johnny" } },
    });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("John Smith");
    await waitFor(() => expect(printedNameCell("John Smith")).toBe("John S."));

    fireEvent.change(nicknameBox("John Smith"), { target: { value: "Johnny" } });
    fireEvent.blur(nicknameBox("John Smith"), { target: { value: "Johnny" } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/people/1/nickname",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ nickname: "Johnny" }) }),
      ),
    );
    // Johnny no longer collides with John Doe, so BOTH names lose the prefix.
    await waitFor(() => expect(printedNameCell("John Smith")).toBe("Johnny"));
    expect(printedNameCell("John Doe")).toBe("John");
  });

  it("clears a nickname when the box is emptied", async () => {
    setSession({ id: 1, isSysadmin: true });
    const withNickname = [{ ...johns[0], nickname: "Johnny" }, johns[1]];
    const fetchMock = mockFetchJson({
      "/api/people/search?roster=active": { people: [{ ...johnRoster[0], nickname: "Johnny" }, johnRoster[1]] },
      "/api/people/search": { people: withNickname },
      "/api/people/1/nickname": { person: { id: 1, name: "John Smith", nickname: null } },
    });
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("John Smith");
    await waitFor(() => expect(printedNameCell("John Smith")).toBe("Johnny"));

    fireEvent.change(nicknameBox("John Smith"), { target: { value: "" } });
    fireEvent.blur(nicknameBox("John Smith"), { target: { value: "" } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/people/1/nickname",
        expect.objectContaining({ body: JSON.stringify({ nickname: null }) }),
      ),
    );
    await waitFor(() => expect(printedNameCell("John Smith")).toBe("John S."));
  });

  // A silent failure here prints the OLD name onto a physical badge, so the save
  // must not move the Printed Name column unless the server took it.
  it("warns and leaves the printed name alone when the nickname save fails", async () => {
    setSession({ id: 1, isSysadmin: true });
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetchJson(johnRoutes); // no /nickname route -> 404
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("John Smith");
    await waitFor(() => expect(printedNameCell("John Smith")).toBe("John S."));

    fireEvent.change(nicknameBox("John Smith"), { target: { value: "Johnny" } });
    fireEvent.blur(nicknameBox("John Smith"), { target: { value: "Johnny" } });

    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ color: "red", autoClose: false }),
      ),
    );
    expect(printedNameCell("John Smith")).toBe("John S.");
    logged.mockRestore();
  });

  it("admits an operations user", async () => {
    setSession({ id: 5, isOperations: true });
    mockFetchJson({ "/api/people/search": { people: participants } });
    renderWithProviders(<PrintBadgesPage />);

    expect(await screen.findByText("Kim Keyholder")).toBeInTheDocument();
  });

  it("shows filter-aware empty state when search matches only inactive people", async () => {
    setSession({ id: 1, isSysadmin: true });
    const inactiveOnly = [
      { id: 5, name: "Inactive Ian", email: "ian@example.com", isMember: false },
      { id: 6, name: "Expired Eve", email: "eve@example.com", isMember: false },
    ];
    mockFetchJson({ "/api/people/search": { people: inactiveOnly } });
    renderWithProviders(<PrintBadgesPage />);

    await waitFor(() =>
      expect(screen.getByText(/hidden by the filter/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/2 hidden by the filter/)).toBeInTheDocument();
    expect(screen.queryByText("No participants found.")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /hide inactive \(2\)/i })).toBeChecked();
  });

  it("holds badge generation when the member roster request fails", async () => {
    setSession({ id: 1, isSysadmin: true });
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const isRoster = input.toString().includes("roster=active");
      return {
        ok: !isRoster,
        status: isRoster ? 500 : 200,
        json: async () => (isRoster ? { error: "Internal Server Error" } : { people: participants }),
      } as Response;
    }) as unknown as typeof fetch;
    renderWithProviders(<PrintBadgesPage />);
    await screen.findByText("Kim Keyholder");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    await waitFor(() => expect(logged).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Generate Badge (2)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generate Sticker (2)" })).toBeDisabled();
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ color: "red", autoClose: false }),
    );
    logged.mockRestore();
  });
});
