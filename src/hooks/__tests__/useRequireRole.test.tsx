import { renderHook } from "@testing-library/react";
import { useRequireRole } from "../useRequireRole";

const push = jest.fn();
let mockSession: { data: unknown; status: string };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
jest.mock("next-auth/react", () => ({
  useSession: () => mockSession,
}));

beforeEach(() => {
  push.mockClear();
});

describe("useRequireRole", () => {
  it("is ready and does not redirect when the user holds an allowed role", () => {
    mockSession = { data: { user: { id: 1, sysadmin: true } }, status: "authenticated" };
    const { result } = renderHook(() => useRequireRole(["sysadmin", "boardMember"]));
    expect(result.current.ready).toBe(true);
    expect(result.current.authorized).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects to / when authenticated but missing every allowed role", () => {
    mockSession = { data: { user: { id: 2, keyholder: true } }, status: "authenticated" };
    const { result } = renderHook(() => useRequireRole(["sysadmin", "boardMember"]));
    expect(result.current.ready).toBe(false);
    expect(result.current.authorized).toBe(false);
    expect(push).toHaveBeenCalledWith("/");
  });

  it("redirects to / when unauthenticated", () => {
    mockSession = { data: null, status: "unauthenticated" };
    const { result } = renderHook(() => useRequireRole(["sysadmin"]));
    expect(result.current.ready).toBe(false);
    expect(push).toHaveBeenCalledWith("/");
  });

  it("sends unauthorized users to options.redirectTo when provided", () => {
    mockSession = { data: { user: { id: 3, keyholder: true } }, status: "authenticated" };
    renderHook(() => useRequireRole(["sysadmin", "boardMember"], { redirectTo: "/admin" }));
    expect(push).toHaveBeenCalledWith("/admin");
  });

  it("reports loading and does not redirect while the session resolves", () => {
    mockSession = { data: null, status: "loading" };
    const { result } = renderHook(() => useRequireRole(["sysadmin"]));
    expect(result.current.loading).toBe(true);
    expect(result.current.ready).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
