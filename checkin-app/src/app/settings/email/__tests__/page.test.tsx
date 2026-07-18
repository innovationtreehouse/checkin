// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl, router } from "@/test-helpers/rtl";
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
    expect(JSON.parse(putOpts!.body as string)).toEqual({
      emailFromAddress: "Org <no-reply@org.test>",
      emailReplyToAddress: "board@org.test",
      scholarshipNotifyEmail: null,
    });
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

  it("accepts a comma-separated Reply-To list: no inline error, PUT fires", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/settings/email": { settings: { emailFromAddress: null, emailReplyToAddress: null } } });
    renderWithProviders(<EmailSettingsPage />);

    await screen.findByLabelText(/From address/i);
    fireEvent.change(screen.getByLabelText(/Reply-To address/i), { target: { value: "info@org.test, ops@org.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/email", expect.objectContaining({ method: "PUT" })));
    expect(screen.queryByText(/Enter one or more comma-separated addresses/i)).not.toBeInTheDocument();
    const [, putOpts] = fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT")!;
    expect(JSON.parse(putOpts!.body as string)).toEqual({
      emailFromAddress: null,
      emailReplyToAddress: "info@org.test, ops@org.test",
      scholarshipNotifyEmail: null,
    });
  });

  it("validates client-side: a malformed From shows an inline error and never PUTs", async () => {
    setSession({ id: 1, isBoardMember: true });
    const fetchMock = mockFetchJson({ "/api/settings/email": { settings: { emailFromAddress: null, emailReplyToAddress: null } } });
    renderWithProviders(<EmailSettingsPage />);

    const from = await screen.findByLabelText(/From address/i);
    fireEvent.change(from, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Enter an email address/i)).toBeInTheDocument();
    // Only the initial GET happened — no PUT was attempted.
    expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === "PUT")).toBe(false);
  });

  it("Scholarship review notifications: renders, loads its value, and trims into the PUT body", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({
      "/api/settings/email": { settings: { emailFromAddress: null, emailReplyToAddress: null, scholarshipNotifyEmail: "finance@org.test" } },
    });
    renderWithProviders(<EmailSettingsPage />);

    const notify = await screen.findByLabelText(/Scholarship review notifications/i);
    expect(notify).toHaveValue("finance@org.test");

    fireEvent.change(notify, { target: { value: " board@org.test, ops@org.test  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/email", expect.objectContaining({ method: "PUT" })));
    const [, putOpts] = fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT")!;
    expect(JSON.parse(putOpts!.body as string)).toEqual({
      emailFromAddress: null,
      emailReplyToAddress: null,
      scholarshipNotifyEmail: "board@org.test, ops@org.test",
    });
  });

  it("Scholarship review notifications: a malformed value shows an inline error and blocks save", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/settings/email": { settings: { emailFromAddress: null, emailReplyToAddress: null, scholarshipNotifyEmail: null } } });
    renderWithProviders(<EmailSettingsPage />);

    const notify = await screen.findByLabelText(/Scholarship review notifications/i);
    fireEvent.change(notify, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Enter one or more comma-separated addresses/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === "PUT")).toBe(false);
  });

  it("redirects a user without board/sysadmin and never renders the form", async () => {
    setSession({ id: 9 }); // authenticated but no roles
    mockFetchJson({ "/api/settings/email": { settings: { emailFromAddress: null, emailReplyToAddress: null } } });
    renderWithProviders(<EmailSettingsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(screen.queryByLabelText(/From address/i)).not.toBeInTheDocument();
  });
});
