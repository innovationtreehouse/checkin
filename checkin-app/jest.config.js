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
    // jest-junit only runs in CI (gated on process.env.CI) so local dev runs
    // don't litter the working tree with test-results/junit.xml on every run;
    // ci.yml feeds that file to dorny/test-reporter to publish a Check Run.
    reporters: [
        'default',
        '<rootDir>/test/failureClassifierReporter.js',
        ...(process.env.CI
            ? [['jest-junit', {
                outputDirectory: 'test-results',
                outputName: 'junit.xml',
                suiteNameTemplate: '{filepath}',
                classNameTemplate: '{classname}',
                titleTemplate: '{title}',
            }]]
            : []),
    ],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    // Coverage (only collected when a run passes --coverage; normal runs are
    // unaffected). v8 provider because next/jest transforms with SWC, not babel,
    // so babel-plugin-istanbul never instruments — v8 reads Node's own coverage.
    coverageProvider: 'v8',
    coverageDirectory: 'coverage',
    coverageReporters: ['text-summary', 'lcov', 'json-summary'],
    // Hard gate: `npm run test:coverage` (the full unit+integration run, the only
    // one that meaningfully measures this — see collectCoverageFrom below) fails
    // if the repo drops under these floors. Only enforced when a run passes
    // --coverage; unit-only test:ci is unaffected.
    coverageThreshold: {
        global: {
            lines: 80,
            branches: 70,
            functions: 68,
        },
    },
    // Count every source file, so untested files show as 0% rather than vanishing.
    collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/*.d.ts',
        '!src/**/__tests__/**',
        '!src/**/__mocks__/**',
        '!src/**/*.test.{ts,tsx}',
        '!src/generated/**',          // generated Prisma client
        '!src/security/generated/**', // generated classification mirror
        '!src/types/**',              // type-only declarations
        '!src/test-helpers/**',
    ],
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
