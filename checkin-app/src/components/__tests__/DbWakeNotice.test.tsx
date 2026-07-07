// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { act, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setSession, resetRtl } from "@/test-helpers/rtl";
import DbWakeNotice, { hardReload } from "../DbWakeNotice";

const TITLE = "Waking up the database…";

/** Scripted probe responses, consumed in order; the last entry repeats. */
function mockProbeSequence(...outcomes: ("ok" | "waking" | "reject")[]) {
    let i = 0;
    const fn = jest.fn(async () => {
        const outcome = outcomes[Math.min(i++, outcomes.length - 1)];
        if (outcome === "reject") throw new DOMException("timeout", "TimeoutError");
        return {
            ok: outcome === "ok",
            status: outcome === "ok" ? 200 : 503,
            json: async () => (outcome === "ok" ? { ok: true } : { ok: false, waking: true }),
        } as Response;
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
}

const reloadMock = jest.fn();
const realReload = hardReload.fn;

beforeEach(() => {
    resetRtl();
    reloadMock.mockClear();
    hardReload.fn = reloadMock;
    setSession({ id: 1 });
});

afterEach(() => {
    hardReload.fn = realReload;
});

describe("DbWakeNotice", () => {
    it("renders nothing when the probe answers ok", async () => {
        const fetchMock = mockProbeSequence("ok");
        renderWithProviders(<DbWakeNotice />);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    });

    it("shows the banner on a 503 waking probe, then reloads once the DB answers ok", async () => {
        jest.useFakeTimers();
        try {
            mockProbeSequence("waking", "ok");
            renderWithProviders(<DbWakeNotice />);

            expect(await screen.findByText(TITLE)).toBeInTheDocument();
            expect(screen.getByText(/starting back up now/)).toBeInTheDocument();

            // Advance past the poll interval; the second probe returns ok → reload.
            await act(async () => {
                await jest.advanceTimersByTimeAsync(3_500);
            });
            await waitFor(() => expect(reloadMock).toHaveBeenCalled());
        } finally {
            jest.useRealTimers();
        }
    });

    it("treats a probe timeout (no answer) as waking — a paused DB stalls the whole request path", async () => {
        mockProbeSequence("reject");
        renderWithProviders(<DbWakeNotice />);

        expect(await screen.findByText(TITLE)).toBeInTheDocument();
    });

    it("does not probe at all when unauthenticated", async () => {
        const fetchMock = mockProbeSequence("ok");
        setSession(null);
        renderWithProviders(<DbWakeNotice />);

        await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
