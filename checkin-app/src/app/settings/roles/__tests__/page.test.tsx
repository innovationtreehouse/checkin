// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import RoleAssignmentPage from "../page";

beforeEach(() => resetRtl());

const users = [
    { id: 1, name: "Ann Admin", email: "ann@example.com", isSysadmin: true, isBoardMember: false, isKeyholder: false, isBackgroundCheckReviewer: false, isYouth: false },
    { id: 2, name: "Yuki Youth", email: "yuki@example.com", isSysadmin: false, isBoardMember: false, isKeyholder: false, isBackgroundCheckReviewer: false, isYouth: true },
];

describe("RoleAssignmentPage", () => {
    it("loads and lists users, hiding youth by default", async () => {
        setSession({ id: 1, isSysadmin: true });
        mockFetchJson({ "/api/roles": { participants: users } });
        renderWithProviders(<RoleAssignmentPage />);

        expect(await screen.findByText("Ann Admin")).toBeInTheDocument();
        expect(screen.queryByText("Yuki Youth")).not.toBeInTheDocument();
    });

    it("filters by search text and toggles a role checkbox", async () => {
        setSession({ id: 1, isSysadmin: true });
        const fetchSpy = mockFetchJson({
            "/api/roles": () => ({ participants: users }),
        });
        renderWithProviders(<RoleAssignmentPage />);

        expect(await screen.findByText("Ann Admin")).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText("Hide Youth"));
        expect(await screen.findByText("Yuki Youth")).toBeInTheDocument();

        const checkboxes = screen.getAllByRole("checkbox").filter((c) => c !== screen.getByLabelText("Hide Youth"));
        fireEvent.click(checkboxes[0]);

        await waitFor(() =>
            expect(fetchSpy).toHaveBeenCalledWith(
                "/api/roles",
                expect.objectContaining({ method: "PATCH" }),
            ),
        );
    });
});
