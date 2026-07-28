import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Bare error logs regress silently: console.error(err) and .catch(console.error)
// emit a stack with no stable context prefix, so grepping prod logs for a
// failure site turns up nothing. Require a literal prefix string —
// console.error("Failed to X:", err) passes. Shared so the api-routes block
// (which replaces, not merges, this rule for its files) stays a superset.
const bareConsoleErrorRules = [
  {
    selector:
      "CallExpression[callee.object.name='console'][callee.property.name='error'][arguments.length=1][arguments.0.type='Identifier']",
    message:
      'Do not log a bare error — add a stable context prefix: console.error("Failed to X:", err).',
  },
  {
    selector:
      "CallExpression[callee.property.name='catch'][arguments.0.object.name='console'][arguments.0.property.name='error']",
    message:
      'Do not pass console.error as a handler — wrap it: .catch((err) => console.error("Failed to X:", err)).',
  },
];

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
  {
    files: ["**/src/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...bareConsoleErrorRules] },
  },
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
    //
    // Flat config replaces (does not merge) a same-named rule, and api files
    // also match the src-wide block above, so this array carries the shared
    // bare-console-error rules too — otherwise this block would silence them.
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
        ...bareConsoleErrorRules,
      ],
    },
  },
]);

export default eslintConfig;
