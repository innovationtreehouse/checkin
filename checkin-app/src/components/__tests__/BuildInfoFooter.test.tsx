import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { BuildInfoFooter, buildLabel } from "../BuildInfoFooter";

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
});

describe("buildLabel", () => {
  it("truncates a full SHA to 7 chars", () => {
    expect(buildLabel("0123456789abcdef0123456789abcdef01234567")).toBe("0123456");
  });

  it("returns 'dev' for an unset SHA", () => {
    expect(buildLabel(undefined)).toBe("dev");
    expect(buildLabel(null)).toBe("dev");
    expect(buildLabel("")).toBe("dev");
  });

  it("prefixes the release tag when both sha and tag are set", () => {
    expect(buildLabel("0123456789abcdef0123456789abcdef01234567", "v1.0.0")).toBe(
      "v1.0.0 0123456",
    );
  });

  it("ignores the tag when there is no sha", () => {
    expect(buildLabel(undefined, "v1.0.0")).toBe("dev");
  });
});

describe("BuildInfoFooter", () => {
  it("renders a build label (dev when NEXT_PUBLIC_GIT_SHA is unset)", () => {
    render(
      <MantineProvider>
        <BuildInfoFooter />
      </MantineProvider>,
    );
    // No SHA is inlined under jest, so it falls back to "dev".
    expect(screen.getByText("build dev")).toBeTruthy();
  });
});
