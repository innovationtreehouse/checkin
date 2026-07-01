/**
 * Shared React Testing Library harness for page/component tests (Phase 2+ of the
 * coverage plan). Lives under test-helpers/ (excluded from coverage) so ~60 page
 * tests don't each reinvent the Mantine + next-auth + next/navigation + fetch
 * mocking.
 *
 * Usage in a test file (jest.mock is hoisted, so the factory must `require`):
 *
 *   jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
 *   jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
 *   import { renderWithProviders, mockFetchJson, setSession, setPathname, router } from "@/test-helpers/rtl";
 *
 *   beforeEach(() => resetRtl());
 *   it("...", () => { setSession({ id: 1, isSysadmin: true }); mockFetchJson({ "/api/x": {...} }); renderWithProviders(<Page />); });
 */
import { render, type RenderOptions } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import type { ReactElement, ReactNode } from "react";

// jsdom lacks matchMedia + ResizeObserver, which Mantine's ScrollArea/Table use.
// Install once at import time; guarded so node-env (integration) files that happen
// to import this don't crash on the missing `window`.
if (typeof window !== "undefined") {
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
}

/** Render `ui` wrapped in a MantineProvider (required by any Mantine component). */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
    return render(<MantineProvider>{ui}</MantineProvider>, options);
}

// ── next/navigation + next-auth/react mocks ──────────────────────────────────
export const router = {
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
};
let pathname = "/";
let searchParams = new URLSearchParams();
let session: { data: unknown; status: string } = { data: null, status: "unauthenticated" };

/** Factory for `jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock())`. */
export function navMock() {
    return {
        useRouter: () => router,
        usePathname: () => pathname,
        useSearchParams: () => searchParams,
        useParams: () => ({}),
        redirect: jest.fn(),
        notFound: jest.fn(),
    };
}
/** Factory for `jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock())`. */
export function authMock() {
    return {
        useSession: () => session,
        signIn: jest.fn(),
        signOut: jest.fn(),
        SessionProvider: ({ children }: { children: ReactNode }) => children,
    };
}

export function setPathname(p: string) {
    pathname = p;
}
export function setSearchParams(sp: URLSearchParams | string) {
    searchParams = typeof sp === "string" ? new URLSearchParams(sp) : sp;
}
/** Set the mocked session user (pass null for signed-out). */
export function setSession(user: Record<string, unknown> | null, status = user ? "authenticated" : "unauthenticated") {
    session = { data: user ? { user } : null, status };
}
/** Reset router spies + pathname/search/session between tests. */
export function resetRtl() {
    Object.values(router).forEach((fn) => (fn as jest.Mock).mockClear());
    pathname = "/";
    searchParams = new URLSearchParams();
    session = { data: null, status: "unauthenticated" };
}

// ── fetch stub ───────────────────────────────────────────────────────────────
/**
 * Stub `global.fetch`, routing by URL substring. Values may be data or a
 * `() => data` factory. A matched route → 200 + json; unmatched → 404.
 * Returns the jest.fn so callers can assert on it.
 */
export function mockFetchJson(routes: Record<string, unknown | (() => unknown)>) {
    const fn = jest.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const key = Object.keys(routes).find((k) => url.includes(k));
        const raw = key !== undefined ? routes[key] : undefined;
        const body = typeof raw === "function" ? (raw as () => unknown)() : raw;
        return {
            ok: key !== undefined,
            status: key !== undefined ? 200 : 404,
            json: async () => body ?? {},
            text: async () => JSON.stringify(body ?? {}),
        } as Response;
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
}

/**
 * Wrap a params/searchParams value as an ALREADY-fulfilled promise so React 19's
 * `use(params)` returns synchronously under RTL. A bare `Promise.resolve(v)`
 * suspends on the first read (its `.then` fires as a microtask, which RTL's sync
 * `render()`/`act()` doesn't await), committing an empty tree. Pre-marking the
 * promise with React's own thenable-cache shape (`status:"fulfilled"`, `value`)
 * makes `use()` unwrap it immediately — no Suspense boundary needed.
 * Usage: `renderWithProviders(<Page params={resolvedParams({ id: "1" })} />)`.
 */
export function resolvedParams<T>(value: T): Promise<T> {
    const p = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
    p.status = "fulfilled";
    p.value = value;
    return p;
}
