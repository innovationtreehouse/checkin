/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require('next/jest')

const createJestConfig = nextJest({
    // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
    dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    testEnvironment: 'jest-environment-jsdom',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
}

module.exports = async () => {
    const jestConfig = await createJestConfig(customJestConfig)();
    
    // next/jest ignores node_modules by default, but @auth/prisma-adapter is ESM
    jestConfig.transformIgnorePatterns = [
        '/node_modules/(?!(@auth/prisma-adapter)/)'
    ];
    
    return jestConfig;
}
