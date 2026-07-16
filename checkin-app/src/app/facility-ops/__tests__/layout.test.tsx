import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import FacilityLayout from "../layout";

const push = jest.fn();
let mockPathname = "/facility-ops/visits";
let mockSession: { data: unknown; status: string };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => mockPathname,
}));
jest.mock("next-auth/react", () => ({
  useSession: () => mockSession,
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

const CHILD = "child-marker";
const renderLayout = (pathname: string, session: { data: unknown; status: string }) => {
  mockPathname = pathname;
  mockSession = session;
  return render(
    <MantineProvider>
      <FacilityLayout>
        <div>{CHILD}</div>
      </FacilityLayout>
    </MantineProvider>,
  );
};

beforeEach(() => {
  push.mockClear();
});

describe("FacilityLayout role gate", () => {
  it("admits a sysadmin", () => {
    renderLayout("/facility-ops/visits", {
      data: { user: { id: 1, isSysadmin: true } },
      status: "authenticated",
    });
    expect(screen.getByText(CHILD)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects an authenticated user with none of the allowed roles", () => {
    renderLayout("/facility-ops/visits", {
      data: { user: { id: 2 } },
      status: "authenticated",
    });
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("redirects unauthenticated callers", () => {
    renderLayout("/facility-ops/visits", { data: null, status: "unauthenticated" });
    expect(push).toHaveBeenCalledWith("/");
  });
});
