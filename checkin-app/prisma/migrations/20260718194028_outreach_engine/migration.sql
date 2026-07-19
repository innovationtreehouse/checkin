-- AlterTable
ALTER TABLE "BoardSettings" ADD COLUMN     "outreachOpeningBody" TEXT,
ADD COLUMN     "outreachOpeningSubject" TEXT,
ADD COLUMN     "outreachReminderBody" TEXT,
ADD COLUMN     "outreachReminderSubject" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "emailSuppressed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BulkSend" (
    "id" SERIAL NOT NULL,
    "emailType" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "senderId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BulkSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkSendItem" (
    "id" SERIAL NOT NULL,
    "bulkSendId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "BulkSendItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkSendItem_bulkSendId_status_idx" ON "BulkSendItem"("bulkSendId", "status");

-- AddForeignKey
ALTER TABLE "BulkSendItem" ADD CONSTRAINT "BulkSendItem_bulkSendId_fkey" FOREIGN KEY ("bulkSendId") REFERENCES "BulkSend"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
