import { POST } from './src/app/api/events/[id]/attendance/route';
import { createMocks } from 'node-mocks-http';
import { PrismaClient } from '@prisma/client';
console.log("We can't test natively because of docker hub limits, but we can verify our fix in unit tests");
