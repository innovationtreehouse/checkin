import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-helpers/rtl";
import { MergedBadge } from "@/components/ui/MergedBadge";

describe("MergedBadge", () => {
  it("renders the badge only for a merged (tombstoned) person", () => {
    renderWithProviders(<MergedBadge person={{ mergedIntoId: null }} />);
    expect(screen.queryByText("merged")).not.toBeInTheDocument();

    renderWithProviders(<MergedBadge person={{ mergedIntoId: 7 }} />);
    expect(screen.getByText("merged")).toBeInTheDocument();
  });
});
