// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { screen, fireEvent } from "@testing-library/react";
import { signIn } from "next-auth/react";
import { renderWithProviders, setSession, resetRtl, router } from "@/test-helpers/rtl";
import SignInPage from "../page";

beforeEach(() => resetRtl());

describe("SignInPage", () => {
    it("wires the Google sign-in button when signed out", () => {
        renderWithProviders(<SignInPage />);

        fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));

        expect(signIn).toHaveBeenCalledWith("google", { callbackUrl: "/" });
    });

    it("offers a continue link when already signed in", () => {
        setSession({ id: 1, name: "Ann Admin" });
        renderWithProviders(<SignInPage />);

        expect(screen.getByRole("link", { name: /continue as ann admin/i })).toBeInTheDocument();
    });

    it("redirects an authenticated, org-OK visitor straight to the callback URL", () => {
        setSession({ id: 1, name: "Ann Admin" });
        renderWithProviders(<SignInPage />);

        expect(router.replace).toHaveBeenCalledWith("/");
    });

    it("renders no sign-in button while the session is still loading", () => {
        setSession(null, "loading");
        renderWithProviders(<SignInPage />);

        expect(screen.queryByRole("button", { name: /sign in with google/i })).not.toBeInTheDocument();
    });
});
