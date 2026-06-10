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
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    testEnvironment: 'jest-environment-jsdom',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testPathIgnorePatterns: [
        '/node_modules/',
        '/.claude/worktrees/',
        '\\.integration\\.test\\.[jt]sx?$',
    ],
    modulePathIgnorePatterns: [
        '<rootDir>/.claude/worktrees/',
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
