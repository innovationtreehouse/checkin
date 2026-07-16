import { render, screen } from "@testing-library/react";
import RootLayout from "../layout";

// Root layout is just html/body + provider wiring, no gating of its own — every
// provider below has its own tests (or is trivial); mock them to passthroughs so
// this test exercises RootLayout's own composition, not its children's internals.
jest.mock("@/components/AuthProvider", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/EnvProvider", () => ({
  EnvProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/DevImpersonationBar", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/DevDashboard", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/OnboardingGate", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/RenewalBanner", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/DbWakeNotice", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/AppFrame", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/UnsavedChangesProvider", () => ({
  UnsavedChangesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

describe("RootLayout", () => {
  it("renders its children inside the provider chrome", () => {
    render(
      <RootLayout>
        <div>{CHILD}</div>
      </RootLayout>,
    );
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });
});
