import { screen } from "@testing-library/react";
import StagingBar from "../StagingBar";
import { renderWithProviders, resetRtl, setStagingInstance } from "@/test-helpers/rtl";

let search = "";
jest.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
    resetRtl();
    search = "";
});

it("renders the staging banner on the staging instance", () => {
    setStagingInstance(true);
    renderWithProviders(<StagingBar />);
    expect(screen.getByText(/Staging instance/)).toBeInTheDocument();
});

it("renders nothing outside staging", () => {
    renderWithProviders(<StagingBar />);
    expect(screen.queryByText(/Staging instance/)).not.toBeInTheDocument();
});

it("renders nothing in kiosk mode, like the dev bar", () => {
    setStagingInstance(true);
    search = "mode=kiosk";
    renderWithProviders(<StagingBar />);
    expect(screen.queryByText(/Staging instance/)).not.toBeInTheDocument();
});
