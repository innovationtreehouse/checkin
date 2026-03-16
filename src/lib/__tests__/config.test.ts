import { config } from '../config';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('databaseUrl', () => {
    it('returns DATABASE_URL when set', () => {
      process.env.DATABASE_URL = 'postgres://localhost:5432';
      expect(config.databaseUrl()).toBe('postgres://localhost:5432');
    });

    it('throws error when DATABASE_URL is missing', () => {
      delete process.env.DATABASE_URL;
      expect(() => config.databaseUrl()).toThrow('Missing required env var: DATABASE_URL');
    });
  });

  describe('nextAuthUrl', () => {
    it('returns NEXTAUTH_URL when set', () => {
      process.env.NEXTAUTH_URL = 'http://myapp.com';
      expect(config.nextAuthUrl()).toBe('http://myapp.com');
    });

    it('returns default when NEXTAUTH_URL is missing', () => {
      delete process.env.NEXTAUTH_URL;
      expect(config.nextAuthUrl()).toBe('http://localhost:4000');
    });
  });

  describe('nextAuthSecret', () => {
    it('returns NEXTAUTH_SECRET when set', () => {
      process.env.NEXTAUTH_SECRET = 'secret';
      expect(config.nextAuthSecret()).toBe('secret');
    });

    it('throws error when NEXTAUTH_SECRET is missing', () => {
      delete process.env.NEXTAUTH_SECRET;
      expect(() => config.nextAuthSecret()).toThrow('Missing required env var: NEXTAUTH_SECRET');
    });
  });

  describe('googleClientId', () => {
    it('returns GOOGLE_CLIENT_ID when set', () => {
      process.env.GOOGLE_CLIENT_ID = 'client-id';
      expect(config.googleClientId()).toBe('client-id');
    });

    it('throws error when GOOGLE_CLIENT_ID is missing', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      expect(() => config.googleClientId()).toThrow('Missing required env var: GOOGLE_CLIENT_ID');
    });
  });

  describe('googleClientSecret', () => {
    it('returns GOOGLE_CLIENT_SECRET when set', () => {
      process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
      expect(config.googleClientSecret()).toBe('client-secret');
    });

    it('throws error when GOOGLE_CLIENT_SECRET is missing', () => {
      delete process.env.GOOGLE_CLIENT_SECRET;
      expect(() => config.googleClientSecret()).toThrow('Missing required env var: GOOGLE_CLIENT_SECRET');
    });
  });

  describe('kioskPublicKey', () => {
    it('returns KIOSK_PUBLIC_KEY when set', () => {
      process.env.KIOSK_PUBLIC_KEY = 'public-key';
      expect(config.kioskPublicKey()).toBe('public-key');
    });

    it('returns null when KIOSK_PUBLIC_KEY is missing', () => {
      delete process.env.KIOSK_PUBLIC_KEY;
      expect(config.kioskPublicKey()).toBeNull();
    });
  });

  describe('resendApiKey', () => {
    it('returns RESEND_API_KEY when set', () => {
      process.env.RESEND_API_KEY = 'api-key';
      expect(config.resendApiKey()).toBe('api-key');
    });

    it('returns null when RESEND_API_KEY is missing', () => {
      delete process.env.RESEND_API_KEY;
      expect(config.resendApiKey()).toBeNull();
    });
  });

  describe('emailFrom', () => {
    it('returns EMAIL_FROM when set', () => {
      process.env.EMAIL_FROM = 'test@example.com';
      expect(config.emailFrom()).toBe('test@example.com');
    });

    it('returns default when EMAIL_FROM is missing', () => {
      delete process.env.EMAIL_FROM;
      expect(config.emailFrom()).toBe('CheckMeIn <onboarding@resend.dev>');
    });
  });

  describe('isDev', () => {
    it('reflects initial NODE_ENV', () => {
      expect(typeof config.isDev).toBe('boolean');
    });
  });

  describe('baseUrl', () => {
    it('returns https://VERCEL_URL if VERCEL_URL is set', () => {
      process.env.VERCEL_URL = 'myapp.vercel.app';
      expect(config.baseUrl()).toBe('https://myapp.vercel.app');
    });

    it('returns NEXTAUTH_URL if VERCEL_URL is not set', () => {
      delete process.env.VERCEL_URL;
      process.env.NEXTAUTH_URL = 'http://myapp.com';
      expect(config.baseUrl()).toBe('http://myapp.com');
    });

    it('returns default if neither is set', () => {
      delete process.env.VERCEL_URL;
      delete process.env.NEXTAUTH_URL;
      expect(config.baseUrl()).toBe('http://localhost:4000');
    });
  });
});
