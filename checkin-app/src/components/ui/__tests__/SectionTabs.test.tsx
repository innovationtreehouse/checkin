import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { SectionTabs } from "@/components/ui/SectionTabs";

const push = jest.fn();
let mockPathname = "/program-ops";
const confirmNav = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => mockPathname,
}));
jest.mock("@/components/UnsavedChangesProvider", () => ({
  useConfirmNav: () => confirmNav,
}));

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
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ||
    (class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver);
});

const LINKS = [
  { name: "Programs", href: "/program-ops" },
  { name: "Events", href: "/program-ops/events" },
];

const renderTabs = () =>
  render(
    <MantineProvider>
      <SectionTabs links={LINKS} prefixMatch />
    </MantineProvider>,
  );

beforeEach(() => {
  push.mockClear();
  confirmNav.mockReset();
  mockPathname = "/program-ops";
});

describe("SectionTabs guarded onChange", () => {
  it("navigates when confirmNav allows it", () => {
    confirmNav.mockReturnValue(true);
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(confirmNav).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/program-ops/events");
  });

  it("blocks navigation when confirmNav returns false (unsaved changes)", () => {
    confirmNav.mockReturnValue(false);
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(confirmNav).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("no-ops (no confirm prompt) when clicking the already-active tab", () => {
    confirmNav.mockReturnValue(true);
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Programs" }));
    expect(confirmNav).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
