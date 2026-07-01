import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-helpers/rtl";
import LiveCertificationsPage from "../page";

describe("LiveCertificationsPage", () => {
    it("embeds the kiosk certifications view", () => {
        renderWithProviders(<LiveCertificationsPage />);

        const iframe = screen.getByTitle("Live Certifications Center");
        expect(iframe).toHaveAttribute("src", "/attendance/certifications?mode=kiosk");
    });
});
