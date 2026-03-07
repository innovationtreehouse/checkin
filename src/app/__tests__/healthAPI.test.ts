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
    });
});
