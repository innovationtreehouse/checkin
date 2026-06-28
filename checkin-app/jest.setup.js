/* eslint-disable @typescript-eslint/no-require-imports */
import '@testing-library/jest-dom'

// Tests run as a non-production environment. Previously this was implicit via
// NODE_ENV=test; under the single CHECKIN_ENV flag we declare it explicitly so
// prod-only gates (e.g. the scan self-check-in block) stay off during tests.
// 'dev' (not 'local') reproduces the old behavior exactly: it disables the
// prod-only gates while leaving the keyless-kiosk fallback and offline
// credential login (both local-only) off, just as NODE_ENV=test did.
process.env.CHECKIN_ENV = 'dev';

// The scan concurrency suite must exercise the advisory lock, not the
// single-connection serialization that a pool of 1 gives for free. Give just
// that suite a pool of 2 so its two scan transactions run on separate
// connections — then the per-participant advisory lock is the only thing that
// serializes them (as in production), and dropping the lock makes the suite
// fail. testPath is populated before setup runs (the prisma mock below relies
// on it too); @/lib/prisma reads TEST_DB_POOL_MAX when it first loads.
{
  const { testPath } = expect.getState();
  // Same reasoning for the program-capacity concurrency suites: they need a
  // pool of >= 2 so their two enroll transactions run on separate connections,
  // making the program-row FOR UPDATE lock (not pool-1 serialization) the thing
  // that serializes them — matching production.
  if (testPath && /(scanConcurrency|attendanceManualConcurrency|programsParticipantsConcurrency|programsPublicRegisterConcurrency|trustedAdultConcurrency)\.integration\.test\.[jt]sx?$/.test(testPath)) {
    process.env.TEST_DB_POOL_MAX = '2';
  }
}

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
