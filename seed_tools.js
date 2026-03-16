const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  await prisma.tool.createMany({
    data: [
      { id: 1, name: "Table Saw", safetyGuide: "https://example.com/safetysaw" },
      { id: 2, name: "Laser Cutter", safetyGuide: "https://example.com/laser" },
      { id: 3, name: "3D Printer", safetyGuide: "https://example.com/3d" }
    ],
    skipDuplicates: true
  });
  console.log("Seeded tools");
}
main().finally(() => prisma.$disconnect());
