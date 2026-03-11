/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Profile API
 * Tests GET and PATCH /api/profile for users viewing and updating their own info
 */

import { GET, PATCH } from '@/app/api/profile/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Profile API Integration Tests', () => {
    let testUserId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'profile-api-test' } },
            select: { id: true }
        });
        
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.visit.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Setup mock database records
        const user = await prisma.participant.create({
            data: { 
                email: 'user-profile-api-test@example.com', 
                name: 'Profile Tester',
                dob: new Date('1990-01-01'),
                homeAddress: '123 Maker Way'
            }
        });
        testUserId = user.id;

        // Create visits for history testing
        await prisma.visit.createMany({
            data: [
                { participantId: testUserId, arrived: new Date(Date.now() - 3600000) },
                { participantId: testUserId, arrived: new Date(Date.now() - 7200000) }
            ]
        });
    });

    afterAll(async () => {
        await prisma.visit.deleteMany({
            where: { participantId: testUserId }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: testUserId }
        });
        
        await prisma.participant.deleteMany({
            where: { id: testUserId }
        });
    });

    describe('GET /api/profile', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/profile', { method: 'GET' });
             const res = await GET(req as any);
             expect(res.status).toBe(401);
        });

        it('should return 404 Not Found for non-existent profile', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 999999 } });

             const req = new Request('http://localhost:4000/api/profile', { method: 'GET' });
             const res = await GET(req as any);
             expect(res.status).toBe(404);
        });

        it('should retrieve profile details and visit history', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

             const req = new Request('http://localhost:4000/api/profile', { method: 'GET' });
             const res = await GET(req as any);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.profile).toBeDefined();
             expect(data.profile.name).toBe('Profile Tester');
             expect(data.profile.homeAddress).toBe('123 Maker Way');
             
             expect(Array.isArray(data.profile.visits)).toBe(true);
             expect(data.profile.visits.length).toBe(2);
        });
    });

    describe('PATCH /api/profile', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/profile', {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Hacker' })
             });
             const res = await PATCH(req as any);
             expect(res.status).toBe(401);
        });

        it('should successfully update partial profile fields', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/profile', {
                method: 'PATCH',
                body: JSON.stringify({ 
                    name: 'Updated Profile Tester',
                    homeAddress: '456 Innovation Blvd'
                })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(200);
            
            const data = await res.json();
            expect(data.profile.name).toBe('Updated Profile Tester');
            expect(data.profile.homeAddress).toBe('456 Innovation Blvd');

            // Verify Audit Trail is populated
            const auditLogs = await prisma.auditLog.findMany({
                where: { actorId: testUserId, action: 'EDIT', tableName: 'Participant', affectedEntityId: testUserId }
            });
            expect(auditLogs.length).toBeGreaterThan(0);
        });
    });
});
