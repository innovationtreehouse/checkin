import type { ReactNode } from "react";
import { screen } from "@testing-library/react";
import { renderWithProviders, resetRtl } from "@/test-helpers/rtl";
import BadgeDocument from "../BadgeDocument";

beforeEach(() => resetRtl());

// @react-pdf/renderer is pure ESM (untransformed by jest, see badgeNames.ts) and its
// primitives target a non-DOM reconciler, so swap them for plain DOM stand-ins to
// exercise BadgeDocument's own layout/branching logic via RTL.
jest.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Page: ({ children }: { children?: ReactNode }) => <div data-testid="pdf-page">{children}</div>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  // eslint-disable-next-line @next/next/no-img-element -- test stand-in, not app UI
  Image: ({ src }: { src?: string }) => <img alt="" src={src} />,
  StyleSheet: { create: (styles: unknown) => styles },
  Font: { register: jest.fn() },
}));

describe("BadgeDocument", () => {
  it("renders names without role pills, and chunks front/back pages of 8", () => {
    // Every fixture row carries both role flags, so a pill that came back would render.
    const badges = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1,
      displayName: `Person ${i + 1}`,
      isBoardMember: true,
      isKeyholder: true,
      qrDataUri: `data:image/png;base64,QR${i}`,
    }));

    renderWithProviders(<BadgeDocument badges={badges} />);

    expect(screen.getByText("Person 1")).toBeInTheDocument();
    expect(screen.getByText("Person 9")).toBeInTheDocument();
    expect(screen.queryByText("BOARD")).toBeNull();
    expect(screen.queryByText("KEYHOLDER")).toBeNull();
    expect(screen.getByText("ID: 1")).toBeInTheDocument();
    expect(screen.getByText("ID: 9")).toBeInTheDocument();
    expect(screen.getAllByText(/^\d{4}-\d{4}$/).length).toBeGreaterThan(0);

    // 9 badges -> 2 chunks of front+back = 4 pages.
    expect(screen.getAllByTestId("pdf-page")).toHaveLength(4);
  });
});
