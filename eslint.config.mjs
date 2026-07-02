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
  // API routes must log through @/lib/logger (console sink + logBackendError),
  // not raw console. Scoped to server routes only — client code can't use the
  // prisma-backed sink. Broadening to all of src is a follow-up.
  {
    files: ["**/src/app/api/**/*.ts"],
    rules: { "no-console": "warn" },
  },
  {
    // P3-1: error responses must go through apiError() (@/lib/api-response) so the
    // { error, details? } shape stays uniform. Bans re-growing a raw
    // NextResponse.json({ error }) / ({ error, details }) in the route surface.
    // Multi-key error bodies (e.g. { error, code }, { error, requiresOverride })
    // are intentional richer contracts and are NOT flagged.
    files: ["**/src/app/api/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='NextResponse'][callee.property.name='json'] > ObjectExpression:has(Property[key.name='error']):not(:has(Property[key.name!='error'][key.name!='details']))",
          message:
            "Return errors via apiError(message, status[, details]) from @/lib/api-response, not a raw NextResponse.json({ error }).",
        },
      ],
    },
  },
]);

export default eslintConfig;
