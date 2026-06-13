import { defineConfig } from "vitest/config";

/**
 * Coverage is gated so an untested export (the original gap: the whole logger module)
 * fails CI instead of slipping through. Thresholds reflect a stateless, dependency-light
 * package — there is no excuse for uncovered branches here.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 90,
        statements: 100,
      },
    },
  },
});
