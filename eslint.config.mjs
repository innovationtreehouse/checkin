import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next. Globs are **-prefixed so
  // they match in the workspace layout whether eslint runs from the repo root
  // or inside checkin-app/ (build output is checkin-app/.next).
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    // Generated Prisma client — emitted by `prisma generate`, never linted.
    "**/src/generated/**",
  ]),
]);

export default eslintConfig;
