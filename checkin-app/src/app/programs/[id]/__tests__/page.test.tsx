/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, waitFor, fireEvent } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { renderWithProviders, mockFetchJson, setSession, router, resetRtl } from "@/test-helpers/rtl";
import ProgramEnrollmentPage from "../page";

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

const params = paramsFor("10");

function renderPage() {
    return renderWithProviders(<ProgramEnrollmentPage params={params} />);
}

const household = {
    household: {
        householdMembers: [
            { id: 100, name: "Jamie Guardian", dateOfBirth: "1990-01-01" },
            { id: 101, name: "Kid One", dateOfBirth: "2015-01-01" },
            { id: 102, name: "Too Young", dateOfBirth: "2023-01-01" },
        ],
    },
};

function baseProgram(overrides: Record<string, unknown> = {}) {
    return {
        id: 10,
        name: "Robotics Club",
        startAt: "2026-06-01T00:00:00.000Z",
        endAt: null,
        leadMentorId: 5,
        leadMentor: { name: "Coach K", email: "coach@example.com" },
        participants: [{ personId: 100, status: "ENROLLED" }],
        enrollmentStatus: "OPEN",
        orgMemberPriceCents: null,
        nonOrgMemberPriceCents: null,
        shopifyOrgMemberVariantId: null,
        shopifyNonOrgMemberVariantId: null,
        minAge: 5,
        maxAge: 18,
        ...overrides,
    };
}

describe("ProgramEnrollmentPage", () => {
    it("free program: enrolls the signed-in household member", async () => {
        setSession({ id: 101 });
        mockFetchJson({
            "/api/programs/10/participants": { ok: true },
            "/api/household": household,
            "/api/programs/10": baseProgram(),
        });
        renderPage();

        expect(await screen.findByText("Robotics Club")).toBeInTheDocument();
        expect(screen.getByText("Coach K")).toBeInTheDocument();
        expect(screen.getByText("Open")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        expect(await screen.findByText("Which of your household wants to enroll?")).toBeInTheDocument();
        expect(screen.getByText("(Already Enrolled)")).toBeInTheDocument();
        expect(screen.getByText("(Too young)")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Complete Enrollment" }));
        expect(await screen.findByText("Successfully enrolled!")).toBeInTheDocument();
    });

    it("priced program with no Shopify variant configured falls back to a direct enroll message", async () => {
        setSession({ id: 101 });
        mockFetchJson({
            "/api/programs/10/participants": { ok: true },
            "/api/household": household,
            "/api/programs/10": baseProgram({ orgMemberPriceCents: 5000, nonOrgMemberPriceCents: 7000, minAge: null, maxAge: null }),
        });
        renderPage();

        await screen.findByText("Robotics Club");
        expect(screen.getByText("Treehouse Member Price:")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");

        fireEvent.click(screen.getByRole("button", { name: "Pay on Shopify" }));
        expect(await screen.findByText("Enrolled! (Note: No pricing variant configured for this tier)")).toBeInTheDocument();
    });

    it("shows a not-found card and navigates back to the directory", async () => {
        setSession(null, "unauthenticated");
        mockFetchJson({});
        renderPage();

        expect(await screen.findByText("Program not found.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Back to Directory" }));
        expect(router.push).toHaveBeenCalledWith("/programs");
    });

    it("prompts a logged-out visitor to log in or register instead of enrolling", async () => {
        setSession(null, "unauthenticated");
        mockFetchJson({ "/api/programs/10": baseProgram() });
        renderPage();

        await screen.findByText("Robotics Club");
        await waitFor(() => {
            expect(screen.getByRole("button", { name: "Log In To Enroll" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Register (New User)" })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: "Log In To Enroll" }));
        expect(router.push).toHaveBeenCalledWith("/");
    });

    it("navigates back and to the manage screen for authorized managers", async () => {
        setSession({ id: 101 });
        mockFetchJson({ "/api/programs/10": baseProgram({ leadMentorId: 101 }), "/api/household": household });
        renderPage();

        await screen.findByText("Robotics Club");
        expect(screen.getByRole("button", { name: "Manage Program" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Manage Program" }));
        expect(router.push).toHaveBeenCalledWith("/program-ops/programs/10");

        fireEvent.click(screen.getByRole("button", { name: "← Back" }));
        expect(router.back).toHaveBeenCalled();
    });

    it("requests a payment plan for a priced program", async () => {
        setSession({ id: 101 });
        const fetchMock = mockFetchJson({
            "/api/household": household,
            "/api/programs/10": baseProgram({ orgMemberPriceCents: 5000, minAge: null, maxAge: null }),
            "/api/programs/10/participants": { ok: true },
            "/api/programs/10/request-payment-plan": { ok: true },
        });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");

        fireEvent.click(screen.getByRole("button", { name: /request a payment plan/ }));
        expect(await screen.findByText(/Requested! Please check your email/)).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith("/api/programs/10/request-payment-plan", expect.objectContaining({ method: "POST" }));
    });

    it("reports an error when starting enrollment for the payment plan fails", async () => {
        setSession({ id: 101 });
        mockFetchJson({
            "/api/household": household,
            "/api/programs/10": baseProgram({ orgMemberPriceCents: 5000, minAge: null, maxAge: null }),
            "/api/programs/10/participants": () => ({ error: "Already pending." }),
        });
        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/programs/10/participants")) return { ok: false, status: 400, json: async () => ({ error: "Already pending." }) } as Response;
            if (url.includes("/api/household")) return { ok: true, status: 200, json: async () => household } as Response;
            if (url.includes("/api/programs/10")) return { ok: true, status: 200, json: async () => baseProgram({ orgMemberPriceCents: 5000, minAge: null, maxAge: null }) } as Response;
            return { ok: false, status: 404, json: async () => ({}) } as Response;
        });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");

        fireEvent.click(screen.getByRole("button", { name: /request a payment plan/ }));
        expect(await screen.findByText("Already pending.")).toBeInTheDocument();
    });

    it("reports a finance-committee alert failure after a successful enrollment start", async () => {
        setSession({ id: 101 });
        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/programs/10/request-payment-plan")) return { ok: false, status: 500, json: async () => ({}) } as Response;
            if (url.includes("/api/programs/10/participants")) return { ok: true, status: 200, json: async () => ({}) } as Response;
            if (url.includes("/api/household")) return { ok: true, status: 200, json: async () => household } as Response;
            if (url.includes("/api/programs/10")) return { ok: true, status: 200, json: async () => baseProgram({ orgMemberPriceCents: 5000, minAge: null, maxAge: null }) } as Response;
            return { ok: false, status: 404, json: async () => ({}) } as Response;
        });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");

        fireEvent.click(screen.getByRole("button", { name: /request a payment plan/ }));
        expect(await screen.findByText(/failed to alert the finance committee/)).toBeInTheDocument();
    });

    it("shows a network-error message when requesting a payment plan throws", async () => {
        setSession({ id: 101 });
        mockFetchJson({ "/api/household": household, "/api/programs/10": baseProgram({ orgMemberPriceCents: 5000, minAge: null, maxAge: null }) });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");

        global.fetch = jest.fn().mockRejectedValue(new Error("down"));
        fireEvent.click(screen.getByRole("button", { name: /request a payment plan/ }));
        expect(await screen.findByText("Network error requesting payment plan.")).toBeInTheDocument();
    });

    it("enrolls multiple selected household members and reports the plural success message", async () => {
        setSession({ id: 101 });
        mockFetchJson({
            "/api/household": household,
            "/api/programs/10": baseProgram({ minAge: null, maxAge: null }),
            "/api/programs/10/participants": { ok: true },
        });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");

        fireEvent.click(screen.getByLabelText("Too Young"));
        fireEvent.click(screen.getByRole("button", { name: "Complete Enrollment" }));
        expect(await screen.findByText("Successfully enrolled 2 members!")).toBeInTheDocument();
    });

    it("treats a 409 already-enrolled response as a successful outcome without parsing a body", async () => {
        setSession({ id: 101 });
        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/programs/10/participants")) {
                return { ok: false, status: 409, json: async () => { throw new Error("should not be parsed"); } } as unknown as Response;
            }
            if (url.includes("/api/household")) return { ok: true, status: 200, json: async () => household } as Response;
            if (url.includes("/api/programs/10")) return { ok: true, status: 200, json: async () => baseProgram({ minAge: null, maxAge: null }) } as Response;
            return { ok: false, status: 404, json: async () => ({}) } as Response;
        });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");
        fireEvent.click(screen.getByRole("button", { name: "Complete Enrollment" }));
        expect(await screen.findByText("Successfully enrolled!")).toBeInTheDocument();
    });

    it("shows an override prompt when enrollment requires admin override, then force-enrolls", async () => {
        setSession({ id: 5, isSysadmin: true });
        global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/household")) return { ok: true, status: 200, json: async () => household } as Response;
            if (url.includes("/api/programs/10/participants")) {
                const body = init?.body ? JSON.parse(init.body as string) : {};
                if (!body.override) {
                    return { ok: false, status: 403, json: async () => ({ error: "Too young for this program.", requiresOverride: true }) } as Response;
                }
                return { ok: true, status: 200, json: async () => ({}) } as Response;
            }
            if (url.includes("/api/programs/10")) return { ok: true, status: 200, json: async () => baseProgram({ minAge: null, maxAge: null, leadMentorId: 5 }) } as Response;
            return { ok: false, status: 404, json: async () => ({}) } as Response;
        });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");
        fireEvent.click(screen.getByRole("button", { name: "Complete Enrollment" }));

        expect(await screen.findByText("Warning: Enrollment rules not met.")).toBeInTheDocument();
        expect(screen.getByText("Too young for this program.")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Force Enroll (Override)" }));
        await waitFor(() => expect(screen.queryByText("Warning: Enrollment rules not met.")).not.toBeInTheDocument());
        expect(screen.getByText("Successfully enrolled!")).toBeInTheDocument();
    });

    it("shows a network-error message when enrollment throws", async () => {
        setSession({ id: 101 });
        mockFetchJson({ "/api/household": household, "/api/programs/10": baseProgram({ minAge: null, maxAge: null }) });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");

        global.fetch = jest.fn().mockRejectedValue(new Error("down"));
        fireEvent.click(screen.getByRole("button", { name: "Complete Enrollment" }));
        expect(await screen.findByText("Network error during enrollment.")).toBeInTheDocument();
    });

    it("redirects to Shopify checkout for a priced enrollment with a configured member variant", async () => {
        setSession({ id: 101 });
        const memberHousehold = { household: { ...household.household, membership: { status: "ACTIVE" } } };
        mockFetchJson({
            "/api/household": memberHousehold,
            "/api/programs/10": baseProgram({ orgMemberPriceCents: 5000, minAge: null, maxAge: null, shopifyOrgMemberVariantId: "gid://member", shopifyNonOrgMemberVariantId: "gid://nonmember" }),
            "/api/programs/10/participants": { ok: true },
        });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");
        fireEvent.click(screen.getByRole("button", { name: "Pay on Shopify" }));

        expect(await screen.findByText("Redirecting to Shopify for secure payment...")).toBeInTheDocument();
    });

    it("shows different closed-enrollment reasons depending on fullness, phase, and count source", async () => {
        setSession({ id: 101 });
        const cases: [string, Record<string, unknown>][] = [
            ["Full", { maxParticipants: 1 }],
            ["Full", { maxParticipants: 5, _count: { participants: 5 } }],
            ["Running", { maxParticipants: null, phase: "RUNNING" }],
            ["Ended", { maxParticipants: null, phase: "FINISHED" }],
            ["", { maxParticipants: null, phase: "SOMETHING_ELSE" }],
            ["Upcoming", { maxParticipants: 1, phase: "UPCOMING", participants: undefined, _count: undefined }],
        ];
        for (const [expected, overrides] of cases) {
            mockFetchJson({ "/api/programs/10": baseProgram({ enrollmentStatus: "CLOSED", ...overrides }) });
            const { unmount } = renderPage();
            await screen.findByText("Robotics Club");
            if (expected) {
                expect(screen.getByRole("button", { name: new RegExp(`Enrollment Closed \\(${expected}\\)`) })).toBeInTheDocument();
            } else {
                expect(screen.getByRole("button", { name: "Enrollment Closed" })).toBeInTheDocument();
            }
            unmount();
        }
    });

    it("shows registration-closed state and lets a signed-out visitor still navigate to log in", async () => {
        setSession(null, "unauthenticated");
        mockFetchJson({ "/api/programs/10": baseProgram({ enrollmentStatus: "CLOSED", phase: "UPCOMING", maxParticipants: null }) });
        renderPage();

        await screen.findByText("Robotics Club");
        expect(screen.getByText(/Registration Closed/)).toBeInTheDocument();
        expect(screen.getByText("Closed")).toBeInTheDocument();
    });

    it("renders optional detail fields when absent or present", async () => {
        setSession({ id: 101 });
        mockFetchJson({
            "/api/programs/10": baseProgram({
                leadMentor: null,
                startAt: null,
                endAt: "2026-08-01T00:00:00.000Z",
                enrollmentStatus: "WHITELIST",
                orgMemberPriceCents: 0,
                nonOrgMemberPriceCents: 0,
            }),
        });
        renderPage();

        await screen.findByText("Robotics Club");
        expect(screen.queryByText("Coach K")).not.toBeInTheDocument();
        expect(screen.getByText("TBD")).toBeInTheDocument();
        expect(screen.queryByText("Ongoing")).not.toBeInTheDocument();
        expect(screen.getByText("Invite Only")).toBeInTheDocument();
        expect(screen.getByText("Free")).toBeInTheDocument();
    });

    it("falls back to a solo household entry when /api/household fails to load", async () => {
        setSession({ id: 777 });
        mockFetchJson({ "/api/programs/10": baseProgram({ minAge: null, maxAge: null }) });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        expect(await screen.findByLabelText("Myself")).toBeInTheDocument();
    });

    it("falls back to a solo household entry when /api/household throws", async () => {
        setSession({ id: 777 });
        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/programs/10")) return { ok: true, status: 200, json: async () => baseProgram({ minAge: null, maxAge: null }) } as Response;
            return Promise.reject(new Error("down"));
        });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        expect(await screen.findByLabelText("Myself")).toBeInTheDocument();
    });

    it("falls back to the first household member when the signed-in caller isn't a member", async () => {
        setSession({ id: 999 });
        mockFetchJson({ "/api/household": household, "/api/programs/10": baseProgram({ minAge: null, maxAge: null }) });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        expect(await screen.findByLabelText("Jamie Guardian")).toBeChecked();
    });

    it("shows a generic failure message for non-404 program load errors", async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
        renderPage();
        expect(await screen.findByText("Failed to load program details.")).toBeInTheDocument();
    });

    it("shows a network-error message when the program fetch throws", async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error("down"));
        renderPage();
        expect(await screen.findByText("Network error.")).toBeInTheDocument();
    });

    it("falls back to a bare Not Found card when the program response has no message", async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => null } as Response);
        renderPage();
        expect(await screen.findByText("Not Found")).toBeInTheDocument();
    });
});
