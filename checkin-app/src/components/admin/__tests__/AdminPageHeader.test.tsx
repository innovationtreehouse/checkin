import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { AdminPageHeader } from "../AdminPageHeader";

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList);
});

const renderHeader = (props: React.ComponentProps<typeof AdminPageHeader>) =>
  render(
    <MantineProvider>
      <AdminPageHeader {...props} />
    </MantineProvider>,
  );

describe("AdminPageHeader", () => {
  it("renders the title", () => {
    renderHeader({ title: "Visit History" });
    expect(screen.getByRole("heading", { name: "Visit History" })).toBeTruthy();
  });

  it("renders no back link when back is omitted", () => {
    const { container } = renderHeader({ title: "Programs" });
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders a back link to the given href", () => {
    renderHeader({ title: "Role Assignment", back: { href: "/admin", label: "← Back to Admin" } });
    const link = screen.getByRole("link", { name: "← Back to Admin" });
    expect(link.getAttribute("href")).toBe("/admin");
  });

  it("renders extra actions alongside the back link", () => {
    renderHeader({
      title: "Participants",
      actions: <button type="button">Add</button>,
      back: { href: "/admin", label: "Back" },
    });
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back" })).toBeTruthy();
  });
});
