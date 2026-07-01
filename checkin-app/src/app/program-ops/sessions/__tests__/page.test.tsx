// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import OneTimeEventsIndex from "../page";

beforeEach(() => resetRtl());

describe("OneTimeEventsIndex", () => {
  it("renders the page chrome and the embedded new-event form", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/programs": [] });
    renderWithProviders(<OneTimeEventsIndex />);

    expect(screen.getByRole("heading", { name: "New One Time Event" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Event Name", { exact: false })).toBeInTheDocument();
  });
});
