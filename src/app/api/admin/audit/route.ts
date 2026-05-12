import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const GET = handler('GET /api/admin/audit', async () => {
    const logs = await prisma.auditLog.findMany({
        orderBy: { time: 'desc' },
        take: 100
    });
    return { AuditLog: logs };
});
