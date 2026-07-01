import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import ShopLayout from "../layout";

const push = jest.fn();
let mockPathname = "/shop-ops/manage";
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
      <ShopLayout>
        <div>{CHILD}</div>
      </ShopLayout>
    </MantineProvider>,
  );
};

beforeEach(() => {
  push.mockClear();
});

describe("ShopLayout role gate", () => {
  it("redirects unauthenticated callers", () => {
    renderLayout("/shop-ops/manage", { data: null, status: "unauthenticated" });
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("shows Access Denied for an authenticated non-certifier", () => {
    renderLayout("/shop-ops/live", { data: { user: { id: 1 } }, status: "authenticated" });
    expect(screen.getByText(/Forbidden/)).toBeInTheDocument();
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });

  it("admits an admin (certifier) to a visible tab", () => {
    renderLayout("/shop-ops/manage", {
      data: { user: { id: 2, isSysadmin: true } },
      status: "authenticated",
    });
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });

  it("blocks a certifier-but-not-admin from an admin-only tab", () => {
    renderLayout("/shop-ops/create", {
      data: { user: { id: 3, toolStatuses: [{ level: "MAY_CERTIFY_OTHERS" }] } },
      status: "authenticated",
    });
    expect(screen.getByText("You do not have access to this section.")).toBeInTheDocument();
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });
});
