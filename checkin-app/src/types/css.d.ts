// Plain CSS side-effect imports, e.g. `import './globals.css'` or
// `import '@mantine/core/styles.css'`. Next bundles these at build time and
// ships type declarations only for CSS *modules* (`*.module.css`), not for
// plain side-effect imports. TypeScript 6 added TS2882, which flags
// side-effect imports of modules without a declaration — previously allowed
// silently. This ambient declaration satisfies that check. The more specific
// `*.module.css` pattern from `next/types/global.d.ts` still wins for CSS
// modules, so their `{ [k: string]: string }` typing is unaffected.
declare module '*.css';
