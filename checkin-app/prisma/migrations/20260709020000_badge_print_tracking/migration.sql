-- Badge print tracking: a durable record of physical ID badges printed for a
-- person. New table only (additive, no data loss). See
-- docs/designs/BADGE_PRINT_TRACKING.md.
CREATE TABLE "BadgePrint" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedById" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "BadgePrint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BadgePrint_personId_printedAt_idx" ON "BadgePrint"("personId", "printedAt");

-- CreateIndex
CREATE INDEX "BadgePrint_printedAt_idx" ON "BadgePrint"("printedAt");

-- AddForeignKey
ALTER TABLE "BadgePrint" ADD CONSTRAINT "BadgePrint_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgePrint" ADD CONSTRAINT "BadgePrint_printedById_fkey" FOREIGN KEY ("printedById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
