import prisma from './src/lib/prisma';
async function main() {
  const c = await prisma.participant.count({ where: { email: { endsWith: '@example.com' } } });
  console.log('Dev personas count:', c);
  const all = await prisma.participant.findMany({ select: { email: true } });
  console.log('All emails:', all.map(a => a.email));
}
main().finally(() => prisma.$disconnect());
