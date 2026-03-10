/**
 * @jest-environment node
 */
/**
 * Integration Tests for Kiosk Certifications API
 * Tests GET /api/kiosk/certifications to secure participant tool statuses for active shop users
 */

import { GET } from '@/app/api/kiosk/certifications/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getKioskPublicKey, verifyKioskSignature } from '@/lib/verify-kiosk';
import { NextRequest } from 'next/server';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

// Mock Kiosk Verification
jest.mock('@/lib/verify-kiosk', () => ({
    getKioskPublicKey: jest.fn(),
    verifyKioskSignature: jest.fn()
}));

describe('Kiosk Certifications API Integration Tests', () => {
    let testUserId: number;
    let toolId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'certifications-api-test' } },
            select: { id: true }
        });
        
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.visit.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });
        
        await prisma.toolStatus.deleteMany({
            where: { userId: { in: existingUserIds } }
        });

        await prisma.tool.deleteMany({
            where: { name: 'Test CNC Router' }
        });
        
        await prisma.participant.deleteMany({
            where: { email: { contains: 'certifications-api-test' } }
        });

        // Setup mock database records
        const user = await prisma.participant.create({
            data: { email: 'user-certifications-api-test@example.com', name: 'User Kiosk Test' }
        });
        testUserId = user.id;

        const tool = await prisma.tool.create({
            data: { name: 'Test CNC Router' }
        });
        toolId = tool.id;

        await prisma.toolStatus.create({
            data: { 
                userId: testUserId,
                toolId: toolId,
                level: 'CERTIFIED'
            }
        });

        await prisma.visit.create({
            data: { participantId: testUserId, arrived: new Date() }
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(async () => {
        // Clean up
        await prisma.visit.deleteMany({
            where: { participantId: testUserId }
        });
        await prisma.toolStatus.deleteMany({
            where: { userId: testUserId }
        });
        await prisma.participant.deleteMany({
            where: { id: testUserId }
        });
        await prisma.tool.deleteMany({
            where: { id: toolId }
        });
    });

    describe('GET /api/kiosk/certifications', () => {
        it('should return 401 Unauthorized without session or Kiosk header', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);
             (getKioskPublicKey as jest.Mock).mockReturnValue('mock-pub-key');

             const req = new Request('http://localhost:4000/api/kiosk/certifications', { method: 'GET' });
             const res = await GET(req as unknown as NextRequest);
             expect(res.status).toBe(401);
        });

        it('should reject invalid Kiosk signatures', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);
             (getKioskPublicKey as jest.Mock).mockReturnValue('mock-pub-key');
             (verifyKioskSignature as jest.Mock).mockReturnValue({ ok: false, status: 401, error: 'Invalid Signature' });

             const req = new Request('http://localhost:4000/api/kiosk/certifications', { 
                 method: 'GET',
                 headers: new Headers({
                     'x-kiosk-signature': 'bad-sig',
                     'x-kiosk-timestamp': '123456789'
                 })
             });

             const res = await GET(req as unknown as NextRequest);
             expect(res.status).toBe(401);
             const data = await res.json();
             expect(data.error).toBe('Invalid Signature');
        });

        it('should return active visits and tools if Kiosk signature is valid', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);
             (getKioskPublicKey as jest.Mock).mockReturnValue('mock-pub-key');
             (verifyKioskSignature as jest.Mock).mockReturnValue({ ok: true });

             const req = new Request('http://localhost:4000/api/kiosk/certifications', { 
                 method: 'GET',
                 headers: new Headers({
                     'x-kiosk-signature': 'good-sig',
                     'x-kiosk-timestamp': '123456789'
                 })
             });

             const res = await GET(req as unknown as NextRequest);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(Array.isArray(data.participants)).toBe(true);
             expect(Array.isArray(data.tools)).toBe(true);
             
             const visitMatches = data.participants.filter((v: {id: number}) => v.id === testUserId);
             expect(visitMatches.length).toBe(1);
             expect(visitMatches[0].toolStatuses.some((t: {toolId: number, level: string}) => t.toolId === toolId && t.level === 'CERTIFIED')).toBe(true);
             
             const toolMatches = data.tools.filter((t: {id: number}) => t.id === toolId);
             expect(toolMatches.length).toBe(1);
             expect(toolMatches[0].name).toBe('Test CNC Router');
        });

        it('should return active visits and tools for authenticated web users', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });
            (getKioskPublicKey as jest.Mock).mockReturnValue('mock-pub-key');

            const req = new Request('http://localhost:4000/api/kiosk/certifications', { method: 'GET' });
            const res = await GET(req as unknown as NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.participants.length).toBeGreaterThanOrEqual(1);
            expect(data.tools.length).toBeGreaterThanOrEqual(1);
        });
    });
});
