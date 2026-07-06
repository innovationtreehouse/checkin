// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import EmailSettingsPage from "../page";

beforeEach(() => resetRtl());

describe("EmailSettingsPage", () => {
  it("first-time set: fields editable, no unlock checkbox, saves the entered identity", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/settings/email": { settings: { emailFromAddress: null, emailReplyToAddress: null } } });
    renderWithProviders(<EmailSettingsPage />);

    const from = await screen.findByLabelText(/From address/i);
    expect(from).not.toBeDisabled();
    expect(screen.queryByText(/let me edit the sender addresses/i)).not.toBeInTheDocument();

    fireEvent.change(from, { target: { value: "Org <no-reply@org.test>" } });
    fireEvent.change(screen.getByLabelText(/Reply-To address/i), { target: { value: "board@org.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/email", expect.objectContaining({ method: "PUT" })));
    const [, putOpts] = fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT")!;
    expect(JSON.parse(putOpts!.body as string)).toEqual({ emailFromAddress: "Org <no-reply@org.test>", emailReplyToAddress: "board@org.test" });
  });

  it("already set: fields locked until the confirm checkbox unlocks them", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/settings/email": { settings: { emailFromAddress: "Org <no-reply@org.test>", emailReplyToAddress: null } } });
    renderWithProviders(<EmailSettingsPage />);

    const from = await screen.findByLabelText(/From address/i);
    expect(from).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/let me edit the sender addresses/i));
    expect(from).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Save settings" })).not.toBeDisabled();
  });
});
