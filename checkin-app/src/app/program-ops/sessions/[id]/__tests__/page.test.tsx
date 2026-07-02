/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { renderWithProviders, mockFetchJson, setSession, router, resetRtl } from "@/test-helpers/rtl";
import EventAdminPage from "../page";

beforeEach(() => resetRtl());

// `use(params)` suspends on any promise it hasn't already tracked, even one that
// resolved microtasks ago — pre-mark it "fulfilled" (React's own thenable-caching
// shape) so `use` returns synchronously and the page doesn't need a Suspense
// boundary/act(async) dance in every test.
function paramsFor(id: string): Promise<{ id: string }> {
    const p = Promise.resolve({ id }) as Promise<{ id: string }> & { status?: string; value?: unknown };
    p.status = "fulfilled";
    p.value = { id };
    return p;
}

function renderPage(params: Promise<{ id: string }>) {
    return renderWithProviders(<EventAdminPage params={params} />);
}

function baseEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: 5,
        name: "Robotics Session",
        startAt: "2020-01-01T18:00:00.000Z",
        endAt: "2020-01-01T20:00:00.000Z",
        attendanceConfirmedAt: null,
        attendanceConfirmedBy: null,
        recurringGroupId: null,
        program: {
            id: 10,
            name: "Robotics",
            leadMentorId: 1,
            volunteers: [
                { participantId: 2, participant: { id: 2, name: "Val Volunteer", email: "val@example.com" }, isCore: true },
            ],
            participants: [
                { participantId: 3, participant: { id: 3, name: "Pat Participant", email: "pat@example.com" } },
            ],
        },
        visits: [{ id: 1, personId: 3, arrivedAt: "2020-01-01T18:05:00.000Z", departedAt: null }],
        rsvps: [{ personId: 3, status: "ATTENDING" }],
        ...overrides,
    };
}

const params = paramsFor("5");

describe("EventAdminPage", () => {
    it("redirects unauthenticated users without fetching", async () => {
        setSession(null, "unauthenticated");
        const fetchSpy = mockFetchJson({});
        renderPage(params);
        await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("shows a not-found card when the event fetch fails", async () => {
        setSession({ id: 1, isSysadmin: true });
        mockFetchJson({});
        renderPage(params);
        expect(await screen.findByText("Failed to load event.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Go Back" }));
        expect(router.back).toHaveBeenCalled();
    });

    it("past event: renders roster/RSVPs, confirms attendance, and saves a manual edit", async () => {
        setSession({ id: 1, isSysadmin: true });
        mockFetchJson({ "/api/events/5": baseEvent() });
        renderPage(params);

        expect(await screen.findByText("Robotics Session")).toBeInTheDocument();
        expect(screen.getAllByText("Pat Participant").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Val Volunteer").length).toBeGreaterThan(0);
        expect(screen.getByText("Attending")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Confirm Attendance" }));
        expect(await screen.findByText("Attendance confirmed successfully!")).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole("button", { name: "Manual Edit" })[0]);
        expect(await screen.findByText(/Manual Edit:/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(await screen.findByText("Attendance updated successfully!")).toBeInTheDocument();
    });

    it("future event: edit mode saves a time change and cancels the event", async () => {
        setSession({ id: 1, isSysadmin: true });
        const future = baseEvent({
            startAt: "2999-01-01T18:00:00.000Z",
            endAt: "2999-01-01T20:00:00.000Z",
            recurringGroupId: "series-1",
        });
        mockFetchJson({ "/api/events/5": future });
        renderPage(params);

        await screen.findByText("Robotics Session");
        fireEvent.click(screen.getByRole("button", { name: "Edit Date / Time" }));
        expect(screen.getByLabelText(/Apply to Series/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Save Time Changes" }));
        expect(await screen.findByText("Event time updated successfully!")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Edit Date / Time" }));
        fireEvent.click(screen.getByRole("button", { name: "Cancel Event(s)" }));

        const confirmModal = await screen.findByRole("dialog", { name: "Cancel Event" });
        fireEvent.click(within(confirmModal).getByRole("button", { name: "Cancel Event(s)" }));
        await waitFor(() => expect(router.push).toHaveBeenCalledWith("/program-ops/programs/10"));
    });
});
