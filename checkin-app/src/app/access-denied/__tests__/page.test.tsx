import { render, screen } from "@testing-library/react";
import AccessDeniedPage from "../page";

describe("AccessDeniedPage", () => {
    it("renders the access-denied message and nothing else", () => {
        render(<AccessDeniedPage />);
        expect(screen.getByRole("heading", { name: "Access Denied" })).toBeInTheDocument();
    });
});
