/* eslint-disable @typescript-eslint/no-require-imports */
import '@testing-library/jest-dom'

// Tests run as a non-production environment. Previously this was implicit via
// NODE_ENV=test; under the single CHECKIN_ENV flag we declare it explicitly so
// prod-only gates (e.g. the scan self-check-in block) stay off during tests.
// 'dev' (not 'local') reproduces the old behavior exactly: it disables the
// prod-only gates while leaving the keyless-kiosk fallback and offline
// credential login (both local-only) off, just as NODE_ENV=test did.
process.env.CHECKIN_ENV = 'dev';

// Polyfill text encoding
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const fetch = require('cross-fetch');
const { Request, Response, Headers } = fetch;

// Polyfill Request and Response for Next.js API routes
global.Request = Request;
global.Response = Response;
global.Headers = Headers;
global.fetch = fetch;

// Mock NextResponse since cross-fetch Response doesn't have .json() static method
jest.mock('next/server', () => {
  return {
    NextResponse: {
      json: (body, init) => {
        return new Response(JSON.stringify(body), {
          ...init,
          headers: {
            'content-type': 'application/json',
            ...(init?.headers || {}),
          },
        });
      },
    },
  };
});

// Mock next-auth to prevent instantiation errors in App Router imports
jest.mock('next-auth', () => {
  const mockNextAuth = jest.fn(() => ({}));
  return {
    __esModule: true,
    default: mockNextAuth,
    getServerSession: jest.fn(() => Promise.resolve(null)),
  };
});

// Mock next-auth/next (used by auth.ts authenticateRequest)
jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(() => Promise.resolve(null)),
}));

// Mock auth-options to prevent cascading ESM imports
// (GoogleProvider → openid-client → jose uses ESM exports that Jest can't handle)
jest.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

// Default safety net for `@/lib/prisma`: in unit tests we should never hit a
// real database. Suites that legitimately need DB behavior live in
// *.integration.test.ts (excluded from `npm run test:ci`). Suites that need
// fine-grained Prisma mocks should `jest.mock('@/lib/prisma', ...)` themselves;
// that per-file mock will override this default. Tests that monkey-patch
// methods on the default mock (e.g. `prisma.event.findMany = jest.fn()`) work
// because each model is a real object that accepts assignment.
jest.mock('@/lib/prisma', () => {
  // Integration tests (*.integration.test.ts via `npm run test:integration`)
  // talk to the real database — give them the real client.
  const { testPath } = expect.getState();
  if (testPath && /\.integration\.test\.[jt]sx?$/.test(testPath)) {
    return jest.requireActual('@/lib/prisma');
  }
  const rejectFn = () => () => Promise.reject(new Error(
    'Unit tests must not call the real Prisma client. ' +
    "Either jest.mock('@/lib/prisma', ...) in this test, " +
    'or rename the file to *.integration.test.ts and run `npm run test:integration`.'
  ));
  const models = new Map();
  const handler = {
    get(_target, prop) {
      if (!models.has(prop)) {
        // Each method access on an unset key returns a rejecting function so
        // accidental calls fail loudly; explicit assignment overrides it.
        models.set(prop, new Proxy({}, {
          get(modelTarget, methodProp) {
            if (methodProp in modelTarget) return modelTarget[methodProp];
            return rejectFn();
          },
        }));
      }
      return models.get(prop);
    },
  };
  return {
    __esModule: true,
    default: new Proxy({}, handler),
  };
});
