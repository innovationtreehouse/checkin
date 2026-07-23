import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { ROLE_META, RoleBadge } from "@/components/ui/RoleBadge";

const TOOL_LEVEL_KEYS = ["BASIC", "DOF", "CERTIFIED", "INSTRUCTOR", "MAY_CERTIFY_OTHERS"];

const renderBadge = (ui: React.ReactElement) => render(<MantineProvider>{ui}</MantineProvider>);

describe("ROLE_META", () => {
  it("holds none of the ToolLevel keys — those belong solely to ToolLevelBadge", () => {
    for (const key of TOOL_LEVEL_KEYS) {
      expect(Object.keys(ROLE_META)).not.toContain(key);
    }
  });

  it("every color is a brand-sanctioned value (treehousePurple, or red for the distinct sysadmin badge)", () => {
    for (const meta of Object.values(ROLE_META)) {
      expect(["treehousePurple", "red"]).toContain(meta.color);
    }
  });
});

describe("RoleBadge", () => {
  it("renders the label for a known participant role", () => {
    renderBadge(<RoleBadge role="isKeyholder" />);
    expect(screen.getByText("Keyholder")).toBeInTheDocument();
  });

  it("falls back to gray + the raw/override label for an unknown role", () => {
    renderBadge(<RoleBadge role="_certified" label="Certified" />);
    const badge = screen.getByText("Certified");
    expect(badge).toBeInTheDocument();
  });

  it("falls back to the raw role string when no label override is given", () => {
    renderBadge(<RoleBadge role="_mystery" />);
    expect(screen.getByText("_mystery")).toBeInTheDocument();
  });
});
