/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require('next/jest')

const createJestConfig = nextJest({
    // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
    dir: './',
})

// Add any custom config to be passed to Jest
// Integration tests (*.integration.test.ts) talk to a real Postgres and are
// excluded from the default run so `npm run test:ci` works without a DB.
// Run them with `npm run test:integration` against a live database.
const customJestConfig = {
    // 'default' keeps jest's built-in output; ours appends a loud summary of
    // tests that failed by THROWING (schema/mock rot) vs honest assertions.
    reporters: ['default', '<rootDir>/test/failureClassifierReporter.js'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    // Integration tier only (gated by INTEGRATION_DB): clone one Postgres DB per
    // worker so parallel workers can't corrupt each other. No-op for `test:ci`.
    globalSetup: '<rootDir>/test/integrationGlobalSetup.js',
    globalTeardown: '<rootDir>/test/integrationGlobalTeardown.js',
    testEnvironment: 'jest-environment-jsdom',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        // Workspace TS package — point jest at its source so it transforms it.
        '^@inventory/money$': '<rootDir>/../packages/money/src/index.ts',
    },
    // The worktree ignore lives at the repo root (.claude/worktrees/), one level
    // up now that rootDir is checkin-app/. testPathIgnorePatterns matches the
    // absolute path, so the bare substring still works; modulePathIgnorePatterns
    // is <rootDir>-anchored and must reach up to the repo root.
    testPathIgnorePatterns: [
        '/node_modules/',
        '/.claude/worktrees/',
        '\\.integration\\.test\\.[jt]sx?$',
        // Flow tests drive a running dev server over HTTP — excluded from the
        // default/unit run; run with `npm run test:flow` (see AGENTS.md).
        '\\.flow\\.test\\.[jt]sx?$',
    ],
    modulePathIgnorePatterns: [
        '<rootDir>/../.claude/worktrees/',
        // The standalone build nests a package.json named "checkmein" under
        // .next/, which collides with the app's own in jest's haste map.
        '<rootDir>/.next/',
    ],
}

module.exports = async () => {
    const jestConfig = await createJestConfig(customJestConfig)();
    
    // next/jest ignores node_modules by default, but @auth/prisma-adapter is ESM,
    // and the prisma-client generator's runtime dynamically imports ESM/WASM files
    // from @prisma/client (e.g. query_compiler_fast_bg.postgresql.mjs) that Jest
    // must transform rather than parse as CommonJS.
    jestConfig.transformIgnorePatterns = [
        '/node_modules/(?!(@auth/prisma-adapter|@prisma/client)/)'
    ];
    
    return jestConfig;
}
