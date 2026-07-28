-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "mergedIntoId" INTEGER;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
