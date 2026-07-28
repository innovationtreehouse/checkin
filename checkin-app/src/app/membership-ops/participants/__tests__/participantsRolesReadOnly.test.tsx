// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));

import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import AdminParticipantsIndex from "../page";

beforeEach(() => {
    resetRtl();
});

// Jane: keyholder only. Bob: board member only. Distinct active-role sets so
// the pill-cluster assertions can't cross-match.
const rows = [
    {
        id: 1, name: "Jane Doe", email: "jane@example.com", phone: null, household: null,
        isSysadmin: false, isBoardMember: false, isKeyholder: true, isBackgroundCheckReviewer: false, isOperations: false,
    },
    {
        id: 2, name: "Bob Board", email: "bob@example.com", phone: null, household: null,
        isSysadmin: false, isBoardMember: true, isKeyholder: false, isBackgroundCheckReviewer: false, isOperations: false,
    },
];

describe("AdminParticipantsIndex — roles pills are read-only", () => {
    it("renders one pill per active role on a row", async () => {
        setSession({ id: 99, isBoardMember: true });
        mockFetchJson({ "/api/people/search": { people: rows } });
        renderWithProviders(<AdminParticipantsIndex />);

        expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
        expect(screen.getByText("Keyholder")).toBeInTheDocument();
        expect(screen.getByText("Board")).toBeInTheDocument();
        expect(screen.queryByText("Sysadmin")).not.toBeInTheDocument();
        expect(screen.queryByText("Operations")).not.toBeInTheDocument();
    });

    it("has no 'Edit roles' button — editing lives solely on /membership-ops/roles", async () => {
        setSession({ id: 99, isBoardMember: true });
        mockFetchJson({ "/api/people/search": { people: rows } });
        renderWithProviders(<AdminParticipantsIndex />);

        await screen.findByText("Jane Doe");
        expect(screen.queryByRole("button", { name: "Edit roles" })).not.toBeInTheDocument();
        // The pointer to the sole editor is present instead.
        expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/membership-ops/roles");
    });
});
