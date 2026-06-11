-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "attendanceConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "attendanceConfirmedById" INTEGER,
ADD COLUMN     "postEventEmailSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurringGroupId" TEXT;

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "phone" TEXT;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_attendanceConfirmedById_fkey" FOREIGN KEY ("attendanceConfirmedById") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
