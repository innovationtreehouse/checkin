import { render, screen } from "@testing-library/react";
import ProgramOpsLayout from "../layout";

const push = jest.fn();
let mockPathname = "/program-ops";
let mockSession: { data: unknown; status: string };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => mockPathname,
}));
jest.mock("next-auth/react", () => ({
  useSession: () => mockSession,
}));

const CHILD = "child-marker";
const renderLayout = (pathname: string, session: { data: unknown; status: string }) => {
  mockPathname = pathname;
  mockSession = session;
  return render(
    <ProgramOpsLayout>
      <div>{CHILD}</div>
    </ProgramOpsLayout>,
  );
};

const leadOfProgram1 = {
  data: { user: { id: 7, programsLed: [1] } },
  status: "authenticated",
};

beforeEach(() => {
  push.mockClear();
});

describe("ProgramOpsLayout row-aware gate", () => {
  it("admits a lead mentor to a program they lead (chrome-less, no redirect)", () => {
    renderLayout("/program-ops/programs/1", leadOfProgram1);
    expect(screen.getByText(CHILD)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects a lead mentor away from a program they do NOT lead", () => {
    renderLayout("/program-ops/programs/2", leadOfProgram1);
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("admits a global admin to any program (row gate is admin-bypassed)", () => {
    renderLayout("/program-ops/programs/2", {
      data: { user: { id: 1, isSysadmin: true, programsLed: [] } },
      status: "authenticated",
    });
    expect(screen.getByText(CHILD)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("admits any authenticated caller to a session flow (page enforces Event->program)", () => {
    renderLayout("/program-ops/sessions/5", {
      data: { user: { id: 9, programsLed: [] } },
      status: "authenticated",
    });
    expect(screen.getByText(CHILD)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects a non-admin off the tabbed hub (no chrome-less escape hatch)", () => {
    renderLayout("/program-ops", {
      data: { user: { id: 9, programsLed: [1] } },
      status: "authenticated",
    });
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("redirects unauthenticated callers", () => {
    renderLayout("/program-ops/programs/1", { data: null, status: "unauthenticated" });
    expect(push).toHaveBeenCalledWith("/");
  });
});
