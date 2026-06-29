/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

// Flow tests drive a RUNNING dev server over HTTP — no app imports, no DB, no
// mocks. They deliberately skip jest.setup.js, which polyfills fetch with
// cross-fetch (no getSetCookie) and mocks prisma/next-auth for in-process unit
// tests. Native Node fetch + a plain node environment is exactly what we want.
module.exports = createJestConfig({
    testEnvironment: 'node',
    setupFilesAfterEnv: [],
    testMatch: ['<rootDir>/flow-tests/**/*.flow.test.[jt]s'],
    moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    // The standalone build nests a package.json named "checkmein" under .next/,
    // which collides with the app's own in jest's haste map.
    modulePathIgnorePatterns: ['<rootDir>/.next/'],
});
