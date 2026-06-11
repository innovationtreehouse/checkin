import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { AlertBanner, type AlertTone } from "../AlertBanner";

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

const renderBanner = (props: Partial<React.ComponentProps<typeof AlertBanner>>) =>
  render(
    <MantineProvider>
      <AlertBanner message={undefined} {...props} />
    </MantineProvider>,
  );

describe("AlertBanner", () => {
  it("renders nothing when message is empty", () => {
    const { container } = renderBanner({ message: "" });
    expect(container.querySelector(".mantine-Alert-root")).toBeNull();
  });

  it("renders the message when present", () => {
    renderBanner({ message: "Saved!", tone: "success" });
    expect(screen.getByText("Saved!")).toBeTruthy();
  });

  it("renders for every tone without error", () => {
    for (const tone of ["success", "error", "info", "warning"] as AlertTone[]) {
      const { container, unmount } = render(
        <MantineProvider>
          <AlertBanner message={`msg-${tone}`} tone={tone} />
        </MantineProvider>,
      );
      expect(screen.getByText(`msg-${tone}`)).toBeTruthy();
      expect(container.querySelector(".mantine-Alert-root")).not.toBeNull();
      unmount();
    }
  });
});
