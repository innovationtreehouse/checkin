import type { ReactNode } from "react";
import { screen } from "@testing-library/react";
import { renderWithProviders, resetRtl } from "@/test-helpers/rtl";
import StickerDocument from "../StickerDocument";

beforeEach(() => resetRtl());

// See BadgeDocument.test.tsx: @react-pdf/renderer is ESM/non-DOM, so stub its
// primitives with plain DOM stand-ins to exercise the layout logic via RTL.
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

describe("StickerDocument", () => {
  it("renders names (falling back to User #id) and chunks pages of 12", () => {
    const badges = [
      ...Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        name: `Kid ${i + 1}`,
        qrDataUri: `data:image/png;base64,Q${i}`,
      })),
      { id: 13, name: "", qrDataUri: "data:image/png;base64,Q13" },
    ];

    renderWithProviders(<StickerDocument badges={badges} />);

    expect(screen.getByText("Kid 1")).toBeInTheDocument();
    expect(screen.getByText("Kid 12")).toBeInTheDocument();
    expect(screen.getByText("User #13")).toBeInTheDocument();
    // 13 badges -> 2 pages of 12.
    expect(screen.getAllByTestId("pdf-page")).toHaveLength(2);
  });
});
