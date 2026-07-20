/**
 * @jest-environment node
 */
/**
 * Integration Tests for Health API
 * Tests GET /api/health for system status probes
 */

import { GET } from '@/app/api/health/route';

describe('Health API Integration Tests', () => {
    describe('GET /api/health', () => {
        it('should return a 200 OK status with "ok" payload', async () => {
             const res = await GET();
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.status).toBe("ok");
        });

        // So a deploy can actually assert the ops-stg access gate is live rather
        // than trusting the task-def env var was set correctly (config.ts isStaging).
        it('reports staging: false off ops-stg', async () => {
            const prev = process.env.CHECKIN_STAGING;
            delete process.env.CHECKIN_STAGING;
            try {
                const data = await (await GET()).json();
                expect(data.staging).toBe(false);
            } finally {
                if (prev === undefined) delete process.env.CHECKIN_STAGING;
                else process.env.CHECKIN_STAGING = prev;
            }
        });

        it('reports staging: true when CHECKIN_STAGING=1', async () => {
            const prev = process.env.CHECKIN_STAGING;
            process.env.CHECKIN_STAGING = '1';
            try {
                const data = await (await GET()).json();
                expect(data.staging).toBe(true);
            } finally {
                if (prev === undefined) delete process.env.CHECKIN_STAGING;
                else process.env.CHECKIN_STAGING = prev;
            }
        });
    });
});
