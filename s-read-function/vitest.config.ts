import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Source uses NodeNext-style `.js` import specifiers (correct for Node/Lambda),
 * but on disk the files are `.ts`. This pre-resolver rewrites a relative `.js`
 * import to its `.ts` sibling when one exists. Generated files that are genuinely
 * `.js` (e.g. the Prisma client) have no `.ts` sibling and fall through untouched.
 */
export default defineConfig({
  plugins: [
    {
      name: "resolve-js-to-ts",
      enforce: "pre",
      resolveId(source, importer) {
        if (importer && source.startsWith(".") && source.endsWith(".js")) {
          const tsPath = resolve(dirname(importer), source.replace(/\.js$/, ".ts"));
          if (existsSync(tsPath)) return tsPath;
        }
        return null;
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      // queries.ts is pure GraphQL query/mutation strings with no logic; it's exercised
      // indirectly by the fakeClient-driven suites, so it carries no threshold worth gating.
      exclude: ["src/shopify/queries.ts"],
      // Suites are fully mocked (fakeClient + fakePrisma), so thresholds are always
      // enforceable — no DB gating needed. cli.ts is now covered. Floors a few points below
      // measured so a real regression trips without flaking on minor shifts.
      thresholds: { lines: 96, functions: 97, statements: 96, branches: 90 },
    },
  },
});
