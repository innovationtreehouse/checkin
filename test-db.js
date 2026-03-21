// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.participant.count({ where: { email: { endsWith: '@example.com' } } });
  console.log('Dev personas count:', c);
  const all = await prisma.participant.findMany({ select: { email: true } });
  console.log('All emails:', all.map(a => a.email));
}
main().finally(() => prisma.$disconnect());
