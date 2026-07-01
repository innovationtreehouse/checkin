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
        participants: [
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
        participants: [{ participantId: 100, status: "ENROLLED" }],
        enrollmentStatus: "OPEN",
        memberPriceCents: null,
        nonMemberPriceCents: null,
        shopifyMemberVariantId: null,
        shopifyNonMemberVariantId: null,
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
            "/api/programs/10": baseProgram({ memberPriceCents: 5000, nonMemberPriceCents: 7000, minAge: null, maxAge: null }),
        });
        renderPage();

        await screen.findByText("Robotics Club");
        expect(screen.getByText("Member Price:")).toBeInTheDocument();
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
    });
});
