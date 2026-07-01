// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl, router } from "@/test-helpers/rtl";
import CreateProgramPage from "../page";

beforeEach(() => resetRtl());

describe("CreateProgramPage", () => {
  it("redirects a caller without sysadmin/board-member role", () => {
    setSession({ id: 1 });
    renderWithProviders(<CreateProgramPage />);
    expect(router.push).toHaveBeenCalledWith("/system-status");
  });

  it("lets an authorized admin fill out the name field and toggle pricing", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({});
    renderWithProviders(<CreateProgramPage />);

    // Required fields render a trailing " *" inside the <label>, so match loosely.
    const nameInput = await screen.findByLabelText("Program Name", { exact: false });
    fireEvent.change(nameInput, { target: { value: "FRC Robotics 2026" } });
    expect(nameInput).toHaveValue("FRC Robotics 2026");

    // Create button starts disabled: no lead mentor picked yet.
    expect(screen.getByRole("button", { name: "Create Program" })).toBeDisabled();

    // Unchecking "free" reveals the price inputs.
    fireEvent.click(screen.getByLabelText("This is a free program"));
    expect(screen.getByLabelText("Member Price ($)")).toBeInTheDocument();
  });
});
