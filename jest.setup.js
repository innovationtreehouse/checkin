/* eslint-disable @typescript-eslint/no-require-imports */
import '@testing-library/jest-dom'

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
