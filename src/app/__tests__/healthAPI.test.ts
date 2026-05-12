/**
 * @jest-environment node
 */
/**
 * Integration Tests for Health API
 * Tests GET /api/health for system status probes
 */

import { GET } from '@/app/api/health/route';
import { NextRequest } from 'next/server';

describe('Health API Integration Tests', () => {
    describe('GET /api/health', () => {
        it('should return a 200 OK status with "ok" payload', async () => {
             const req = new Request('http://localhost/api/health', { method: 'GET' });
             const res = await GET(req as unknown as NextRequest);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.status).toBe("ok");
        });
    });
});
