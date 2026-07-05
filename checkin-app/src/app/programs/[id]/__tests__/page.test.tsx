/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, waitFor, fireEvent } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));
import { notifications } from "@mantine/notifications";
import { signIn } from "next-auth/react";
import { renderWithProviders, mockFetchJson, setSession, router, resetRtl } from "@/test-helpers/rtl";
import ProgramEnrollmentPage from "../page";

beforeEach(() => {
    resetRtl();
    (notifications.show as jest.Mock).mockClear();
    (signIn as jest.Mock).mockClear();
});

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
        participants: [{ personId: 100, status: "ACTIVE" }],
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
        expect(screen.getByText("(Enrolled)")).toBeInTheDocument();
        expect(screen.getByText("(Too young)")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Complete Enrollment" }));
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Successfully enrolled!" })),
        );
    });

    it("first-time user finishes household setup, then enrolls a child (auth-first)", async () => {
        setSession({ id: 500 });
        let childAdded = false;
        const adult = { id: 500, name: "New Parent", dateOfBirth: null };
        const child = { id: 501, name: "New Kid", dateOfBirth: "2015-01-01" };
        // Process-free intake state; the POST mutates it (child + emergency
        // contact now saved) so the subsequent EC probe reads them back.
        const intakeState = {
            prefill: {
                household: { emergencyContactName: null, emergencyContactPhone: null, emergencyContactEmail: null, line1: null },
                primaryParent: { id: 500, name: "New Parent", email: null, dob: null, over25: false, allergies: null },
                secondaryParent: null,
                children: [] as unknown[],
            },
        };
        const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b } as Response);
        global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.toString();
            // Order matters: /api/household/intake also contains "/api/household".
            if (url.includes("/api/household/intake")) {
                if (init?.method === "POST") {
                    childAdded = true;
                    intakeState.prefill.household.emergencyContactName = "Aunt May" as unknown as null;
                    intakeState.prefill.household.emergencyContactPhone = "5125550000" as unknown as null;
                    return json({ state: intakeState, rejections: [] });
                }
                return json(intakeState);
            }
            if (url.includes("/api/household")) return json({ household: { householdMembers: childAdded ? [adult, child] : [adult] } });
            if (url.includes("/api/programs/10/participants")) return json({});
            if (url.includes("/api/programs/10")) return json(baseProgram({ participants: [] }));
            return { ok: false, status: 404, json: async () => ({}) } as Response;
        });
        renderPage();

        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        // No enrollable participant yet -> first-time setup affordance.
        fireEvent.click(await screen.findByRole("button", { name: "Finish setting up your household to enroll" }));

        // Panel mounts, prefilled with the adult's name; add the child + emergency contact.
        await screen.findByText("Finish setting up your household");
        fireEvent.click(screen.getByRole("button", { name: "+ Add household member" }));
        fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Kid" } });
        fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "2015-01-01" } });
        fireEvent.change(screen.getByLabelText(/Emergency contact name/), { target: { value: "Aunt May" } });
        fireEvent.change(screen.getByLabelText(/Emergency contact phone/), { target: { value: "5125550000" } });
        fireEvent.click(screen.getByRole("button", { name: "Save & continue to enroll" }));

        // Back to member-select with the now-enrollable child preselected.
        await screen.findByText("Which of your household wants to enroll?");
        expect(await screen.findByLabelText("New Kid")).toBeChecked();
        fireEvent.click(screen.getByRole("button", { name: "Complete Enrollment" }));
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Successfully enrolled!" })),
        );
    });

    it("over-25 adult with only an already-enrolled child sees a no-eligible message, not a DOB error", async () => {
        setSession({ id: 200 });
        mockFetchJson({
            "/api/household": {
                household: {
                    householdMembers: [
                        { id: 200, name: "Parent Adult", dateOfBirth: null, isDeclaredAdult: true },
                        { id: 201, name: "Only Kid", dateOfBirth: "2015-01-01" },
                    ],
                },
            },
            "/api/programs/10": baseProgram({ participants: [{ personId: 201, status: "PENDING" }], minAge: 5, maxAge: 16 }),
        });
        renderPage();

        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        await screen.findByText("Which of your household wants to enroll?");

        // Declared adult reads as "(Adult)", never the confusing "(DOB missing)".
        expect(screen.getByText("(Adult)")).toBeInTheDocument();
        expect(screen.queryByText("(DOB missing)")).not.toBeInTheDocument();
        // PENDING enrollment reads as payment-pending, not a bare "Enrolled".
        expect(screen.getByText("(Enrolled — Payment Pending)")).toBeInTheDocument();
        // No enrollable member -> first-time setup affordance (replaces the old
        // dead-end alert), no direct enroll button.
        expect(screen.getByRole("button", { name: "Finish setting up your household to enroll" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Complete Enrollment" })).not.toBeInTheDocument();
    });

    it("priced program with no Shopify variant configured aborts before enrolling", async () => {
        setSession({ id: 101 });
        const fetchMock = mockFetchJson({
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
        // No chargeable variant → persistent error, and NO enrollment is created.
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({
                color: "red",
                autoClose: false,
                message: "Cannot enroll: no pricing variant set for this program tier — set one in program-ops.",
            })),
        );
        expect(fetchMock).not.toHaveBeenCalledWith("/api/programs/10/participants", expect.anything());
    });

    it("shows a not-found card and navigates back to the directory", async () => {
        setSession(null, "unauthenticated");
        mockFetchJson({});
        renderPage();

        expect(await screen.findByText("Program not found.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Back to Directory" }));
        expect(router.push).toHaveBeenCalledWith("/programs");
    });

    it("routes a logged-out visitor through /signin (carrying the return URL) before enrolling (auth-first)", async () => {
        setSession(null, "unauthenticated");
        mockFetchJson({ "/api/programs/10": baseProgram() });
        renderPage();

        await screen.findByText("Robotics Club");
        // Single auth-first CTA — no anonymous "Register (New User)" leak.
        await screen.findByRole("button", { name: "Sign in to enroll" });
        expect(screen.queryByRole("button", { name: "Register (New User)" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Sign in to enroll" }));
        // LOCAL never calls Google directly; /signin decides Google vs. the dev picker by env.
        expect(signIn).not.toHaveBeenCalled();
        expect(router.push).toHaveBeenCalledWith("/signin?callbackUrl=/programs/10");
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
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Requested! Please check your email/) })),
        );
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
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "red", message: "Network error requesting payment plan.", autoClose: false })),
        );
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
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Successfully enrolled 2 members!" })),
        );
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
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Successfully enrolled!" })),
        );
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
        expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Successfully enrolled!" }));
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
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "red", message: "Network error during enrollment.", autoClose: false })),
        );
    });

    it("redirects to Shopify checkout for a priced enrollment with a configured member variant", async () => {
        setSession({ id: 101 });
        const prevDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
        process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "shop.example.com"; // redirect requires a store domain
        try {
            const memberHousehold = { household: { ...household.household, orgMembership: { status: "ACTIVE" } } };
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
        } finally {
            process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = prevDomain;
        }
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

    it("shows a disabled closed CTA to a signed-out visitor", async () => {
        setSession(null, "unauthenticated");
        mockFetchJson({ "/api/programs/10": baseProgram({ enrollmentStatus: "CLOSED", phase: "UPCOMING", maxParticipants: null }) });
        renderPage();

        await screen.findByText("Robotics Club");
        // Auth-first CTA reuses the same disabled-closed treatment as the logged-in Enroll button.
        expect(screen.getByRole("button", { name: /Enrollment Closed \(Upcoming\)/ })).toBeDisabled();
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

    it("falls back to the first eligible household member when the signed-in caller isn't a member", async () => {
        setSession({ id: 999 });
        // Jamie (id 100) is already enrolled in baseProgram, so the fallback must
        // skip him and preselect the first enrollable member instead of a member
        // whose POST would fail.
        mockFetchJson({ "/api/household": household, "/api/programs/10": baseProgram({ minAge: null, maxAge: null }) });
        renderPage();
        await screen.findByText("Robotics Club");
        fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
        expect(await screen.findByLabelText("Kid One")).toBeChecked();
        expect(screen.getByLabelText("Jamie Guardian")).not.toBeChecked();
    });

    it("shows a generic failure message for non-404 program load errors", async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
        renderPage();
        expect(await screen.findByText("Failed to load program details.")).toBeInTheDocument();
    });

    it("shows a network-error message when the program fetch throws", async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error("down"));
        renderPage();
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "red", message: "Network error.", autoClose: false })),
        );
    });

    it("falls back to a bare Not Found card when the program response has no message", async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => null } as Response);
        renderPage();
        expect(await screen.findByText("Not Found")).toBeInTheDocument();
    });
});
