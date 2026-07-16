import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import MyActivitiesLayout from "../layout";

const push = jest.fn();
let mockPathname = "/my-activities/events";
let mockSession: { status: string };

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
const renderLayout = (pathname: string, session: { status: string }) => {
  mockPathname = pathname;
  mockSession = session;
  return render(
    <MantineProvider>
      <MyActivitiesLayout>
        <div>{CHILD}</div>
      </MyActivitiesLayout>
    </MantineProvider>,
  );
};

beforeEach(() => {
  push.mockClear();
});

describe("MyActivitiesLayout sign-in gate", () => {
  it("admits any authenticated caller", () => {
    renderLayout("/my-activities/events", { status: "authenticated" });
    expect(screen.getByText(CHILD)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a loader while the session resolves", () => {
    renderLayout("/my-activities/events", { status: "loading" });
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated callers", () => {
    renderLayout("/my-activities/events", { status: "unauthenticated" });
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/");
  });
});
