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

  it("prefers describe over the tag+sha pair — it carries strictly more", () => {
    expect(
      buildLabel("0123456789abcdef0123456789abcdef01234567", "v1.0.0", "v1.0.8-2-g0123456"),
    ).toBe("v1.0.8-2-g0123456");
  });

  it("prefixes the branch when both branch and describe are set", () => {
    expect(buildLabel("0123456", null, "v1.0.8-0-ge790e17", "rel/1.0")).toBe(
      "rel/1.0 v1.0.8-0-ge790e17",
    );
  });

  it("renders describe alone when the branch is unknown (nothing sets it yet)", () => {
    expect(buildLabel("0123456", null, "v1.0.8-0-ge790e17")).toBe("v1.0.8-0-ge790e17");
  });

  it("falls back to tag+sha for an image built before describe existed", () => {
    // A running image predating this change has no NEXT_PUBLIC_GIT_DESCRIBE.
    // It must keep its old label, not regress to "dev".
    expect(buildLabel("0123456789abcdef0123456789abcdef01234567", "v1.0.0", undefined)).toBe(
      "v1.0.0 0123456",
    );
  });

  it("still labels a describe-only build when the sha is somehow unset", () => {
    // describe is self-contained; it should not require the sha var too.
    expect(buildLabel(undefined, null, "v1.0.8-0-ge790e17")).toBe("v1.0.8-0-ge790e17");
  });

  it("branches the label even with no describe, using the fallback version", () => {
    expect(buildLabel("0123456789abcdef", "v1.0.0", null, "main")).toBe("main v1.0.0 0123456");
  });

  it("ignores the tag when there is no sha", () => {
    expect(buildLabel(undefined, "v1.0.0")).toBe("dev");
  });

  const SHA = "0123456789abcdef0123456789abcdef01234567";

  it("branch only: prefixes the branch, no tag", () => {
    expect(buildLabel(SHA, undefined, undefined, "rel/1.2")).toBe("rel/1.2 0123456");
  });

  it("tag only: prefixes the tag, no branch", () => {
    expect(buildLabel(SHA, "v1.0.0", undefined, undefined)).toBe("v1.0.0 0123456");
  });

  it("both branch and tag: branch then tag then sha", () => {
    expect(buildLabel(SHA, "v1.0.0", undefined, "rel/1.2")).toBe("rel/1.2 v1.0.0 0123456");
  });

  it("neither branch nor tag: sha alone", () => {
    expect(buildLabel(SHA, undefined, undefined, undefined)).toBe("0123456");
  });

  it("ignores branch when there is no sha", () => {
    expect(buildLabel(undefined, undefined, undefined, "main")).toBe("dev");
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
